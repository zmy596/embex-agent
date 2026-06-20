import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface KnowledgeDocument {
  id: string;
  filename: string;
  title: string;
  type: string;
  source: string;
  tags: string[];
  uploaded_at: string;
  indexed_at: string;
  status: "indexed" | "failed";
  chunks: number;
  size: number;
}

export interface KnowledgeChunk {
  id: string;
  document_id: string;
  filename: string;
  title: string;
  chunk_index: number;
  text: string;
  tags: string[];
  source: string;
  score?: number;
  match_terms?: string[];
}

interface KnowledgeManifest {
  version: number;
  name: string;
  documents: KnowledgeDocument[];
  updated_at: string;
  notes?: string[];
}

const ragRoot = path.join(process.cwd(), "esp_agent", "knowledge", "rag");
const rawDir = path.join(ragRoot, "documents");
const manifestPath = path.join(ragRoot, "knowledge_manifest.json");
const chunksPath = path.join(ragRoot, "chunks.jsonl");
const indexPath = path.join(ragRoot, "index.json");

export async function listKnowledgeFiles() {
  await ensureRagStore();
  const manifest = await readManifest();
  return {
    success: true,
    files: manifest.documents,
    total: manifest.documents.length,
    manifest_path: manifestPath
  };
}

export async function uploadKnowledgeText(input: {
  filename?: string;
  title?: string;
  content?: string;
  tags?: string[];
  source?: string;
  section?: string;
}) {
  await ensureRagStore();
  const content = String(input.content || "").trim();
  if (!content) throw new Error("Knowledge content is required.");
  const filename = sanitizeFilename(input.filename || `${Date.now()}-knowledge.md`);
  const section = sanitizeSection(input.section || "uploads");
  const title = String(input.title || filename).trim();
  const tags = normalizeTags(input.tags);
  const source = String(input.source || "web_upload");
  const id = `${Date.now()}-${hashText(filename + content).slice(0, 8)}`;
  const sectionDir = path.join(rawDir, section);
  await mkdir(sectionDir, { recursive: true });
  const rawPath = path.join(sectionDir, `${id}-${filename}`);
  await writeFile(rawPath, content, "utf8");
  const storedFilename = `${section}/${filename}`;

  const inferredTags = tags.length ? tags : inferTags(filename, content);
  const normalizedTitle = title || inferTitle(content, filename);
  const chunks = chunkText(content).map((text, index) => ({
    id: `${id}-chunk-${index}`,
    document_id: id,
    filename: storedFilename,
    title: normalizedTitle,
    chunk_index: index,
    text,
    tags: inferredTags,
    source
  }));

  const manifest = await readManifest();
  const record: KnowledgeDocument = {
    id,
    filename: storedFilename,
    title: normalizedTitle,
    type: extensionOf(filename),
    source,
    tags: inferredTags,
    uploaded_at: new Date().toISOString(),
    indexed_at: new Date().toISOString(),
    status: "indexed",
    chunks: chunks.length,
    size: Buffer.byteLength(content, "utf8")
  };
  manifest.documents = [record, ...manifest.documents.filter((item) => item.id !== id)];
  manifest.updated_at = new Date().toISOString();
  await writeManifest(manifest);
  await appendChunks(chunks);
  await writeIndexSummary();

  return {
    success: true,
    document: record,
    chunks: chunks.length,
    raw_path: rawPath
  };
}

export async function deleteKnowledgeDocument(id: string) {
  await ensureRagStore();
  const documentId = String(id || "").trim();
  if (!documentId) throw new Error("Knowledge document id is required.");
  const manifest = await readManifest();
  const document = manifest.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("Knowledge document not found.");
  if (!isUserKnowledgeDocument(document)) {
    throw new Error("Only user-uploaded knowledge documents can be deleted from the web page.");
  }
  const files = await listKnowledgeFilesRecursive(rawDir);
  const rawFile = files.find((relativePath) => path.basename(relativePath).includes(document.id) || normalizeStoredFilename(relativePath) === document.filename);
  if (rawFile) {
    await rm(path.join(rawDir, rawFile), { force: true });
  }
  const chunks = await readChunks();
  const nextChunks = chunks.filter((chunk) => chunk.document_id !== document.id);
  manifest.documents = manifest.documents.filter((item) => item.id !== document.id);
  manifest.updated_at = new Date().toISOString();
  await writeManifest(manifest);
  await writeFile(chunksPath, nextChunks.map((chunk) => JSON.stringify(chunk)).join("\n") + (nextChunks.length ? "\n" : ""), "utf8");
  await writeIndexSummary();
  return {
    success: true,
    deleted: document
  };
}

export async function searchKnowledge(query: string, limit = 5) {
  await ensureRagStore();
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return { success: true, query: normalizedQuery, hits: [], total: 0 };
  const chunks = await readChunks();
  const terms = expandQueryTerms(normalizedQuery);
  const hits = chunks
    .map((chunk) => ({
      ...chunk,
      ...scoreChunk(chunk, terms, normalizedQuery)
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score);
  const selectedHits = selectDiverseHits(hits, Math.max(1, Math.min(20, Math.trunc(limit))));
  return {
    success: true,
    query: normalizedQuery,
    retrieval: "hybrid-keyword-local",
    terms,
    hits: selectedHits,
    total: selectedHits.length,
    scanned: chunks.length
  };
}

export async function reindexKnowledge() {
  await ensureRagStore();
  const manifest = await readManifest();
  const files = await listKnowledgeFilesRecursive(rawDir);
  const nextChunks: KnowledgeChunk[] = [];
  const nextDocuments: KnowledgeDocument[] = [];
  for (const relativePath of files) {
    const file = path.basename(relativePath);
    if (isIgnoredKnowledgeFile(relativePath)) continue;
    const filePath = path.join(rawDir, relativePath);
    const info = await stat(filePath);
    if (!info.isFile()) continue;
    const content = await readFile(filePath, "utf8");
    const existing = manifest.documents.find((item) => file.includes(item.id) || item.filename === normalizeStoredFilename(relativePath));
    const id = existing?.id || hashText(relativePath).slice(0, 12);
    const filename = existing?.filename || normalizeStoredFilename(relativePath);
    const title = existing?.title || inferTitle(content, filename);
    const tags = existing?.tags?.length ? existing.tags : inferTags(filename, content);
    const source = existing?.source || inferSource(relativePath);
    const chunks = chunkText(content).map((text, index) => ({
      id: `${id}-chunk-${index}`,
      document_id: id,
      filename,
      title,
      chunk_index: index,
      text,
      tags,
      source
    }));
    nextChunks.push(...chunks);
    nextDocuments.push({
      id,
      filename,
      title,
      type: extensionOf(filename),
      source,
      tags,
      uploaded_at: existing?.uploaded_at || new Date().toISOString(),
      indexed_at: new Date().toISOString(),
      status: "indexed",
      chunks: chunks.length,
      size: Buffer.byteLength(content, "utf8")
    });
  }
  manifest.documents = nextDocuments;
  manifest.updated_at = new Date().toISOString();
  await writeManifest(manifest);
  await writeFile(chunksPath, nextChunks.map((chunk) => JSON.stringify(chunk)).join("\n") + (nextChunks.length ? "\n" : ""), "utf8");
  await writeIndexSummary();
  return { success: true, files: nextDocuments.length, chunks: nextChunks.length };
}

async function ensureRagStore() {
  await mkdir(ragRoot, { recursive: true });
  await mkdir(rawDir, { recursive: true });
  try {
    await readFile(manifestPath, "utf8");
  } catch {
    await writeManifest({ version: 1, name: "Embex Local RAG Knowledge Base", documents: [], updated_at: "", notes: [] });
  }
  try {
    await readFile(chunksPath, "utf8");
  } catch {
    await writeFile(chunksPath, "", "utf8");
  }
  try {
    await readFile(indexPath, "utf8");
  } catch {
    await writeFile(indexPath, JSON.stringify({ version: 1, chunks: 0, status: "not_indexed", updated_at: "" }, null, 2), "utf8");
  }
}

async function readManifest(): Promise<KnowledgeManifest> {
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<KnowledgeManifest>;
  return {
    version: Number(parsed.version || 1),
    name: String(parsed.name || "Embex Local RAG Knowledge Base"),
    documents: Array.isArray(parsed.documents) ? parsed.documents as KnowledgeDocument[] : [],
    updated_at: String(parsed.updated_at || ""),
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : []
  };
}

async function writeManifest(manifest: KnowledgeManifest) {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

async function appendChunks(chunks: KnowledgeChunk[]) {
  const existing = await readChunks();
  const documentIds = new Set(chunks.map((chunk) => chunk.document_id));
  const next = existing.filter((chunk) => !documentIds.has(chunk.document_id)).concat(chunks);
  await writeFile(chunksPath, next.map((chunk) => JSON.stringify(chunk)).join("\n") + (next.length ? "\n" : ""), "utf8");
  await writeIndexSummary();
}

async function readChunks(): Promise<KnowledgeChunk[]> {
  const raw = await readFile(chunksPath, "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as KnowledgeChunk);
}

async function writeIndexSummary() {
  const chunks = await readChunks();
  await writeFile(indexPath, JSON.stringify({
    version: 2,
    chunks: chunks.length,
    embedding_provider: "hybrid-keyword-local",
    features: ["recursive_documents", "stable_reindex_ids", "heading_chunking", "cjk_bigram_terms", "title_tag_boost"],
    updated_at: new Date().toISOString(),
    status: chunks.length ? "indexed" : "not_indexed"
  }, null, 2), "utf8");
}

function chunkText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const sections = splitMarkdownSections(normalized);
  const chunks: string[] = [];
  const max = 1200;
  const overlap = 160;
  for (const section of sections) {
    if (section.length <= max) {
      chunks.push(section);
      continue;
    }
    for (let start = 0; start < section.length; start += max - overlap) {
      const part = section.slice(start, start + max).trim();
      if (part) chunks.push(part);
      if (start + max >= section.length) break;
    }
  }
  return chunks;
}

function scoreChunk(chunk: KnowledgeChunk, terms: string[], rawQuery: string) {
  const titleText = normalizeSearchText(`${chunk.title}\n${chunk.filename}\n${chunk.tags.join(" ")}`);
  const bodyText = normalizeSearchText(chunk.text);
  const allText = `${titleText}\n${bodyText}`;
  const query = normalizeSearchText(rawQuery);
  let score = 0;
  const matchTerms: string[] = [];
  for (const term of terms) {
    if (!term) continue;
    if (titleText.includes(term)) {
      score += term.length > 1 ? 5 : 2;
      matchTerms.push(term);
      continue;
    }
    if (bodyText.includes(term)) {
      score += term.length > 1 ? 2 : 1;
      matchTerms.push(term);
    }
  }
  if (query && allText.includes(query)) score += 8;
  if (chunk.source === "builtin_rag") score += 0.5;
  return { score, match_terms: [...new Set(matchTerms)].slice(0, 12) };
}

function tokenize(value: string) {
  const normalized = normalizeSearchText(value);
  const ascii = normalized.match(/[a-z0-9_#.+-]+/g) || [];
  const cjk = [...value.matchAll(/[\u4e00-\u9fa5]{2,}/g)].map((match) => match[0]);
  return [...new Set([...ascii, ...cjk])];
}

async function listKnowledgeFilesRecursive(root: string) {
  const output: string[] = [];
  async function walk(current: string, prefix = "") {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else {
        output.push(relativePath);
      }
    }
  }
  await walk(root);
  return output.sort((a, b) => a.localeCompare(b));
}

function isIgnoredKnowledgeFile(relativePath: string) {
  const file = path.basename(relativePath);
  if (file.startsWith(".") || file === ".gitkeep") return true;
  if (/^~\$/.test(file)) return true;
  const ext = extensionOf(file);
  return !["md", "markdown", "txt", "log", "json", "csv", "ini", "yaml", "yml", "c", "cpp", "h", "hpp", "ino", "py", "ts", "tsx", "js", "mjs"].includes(ext);
}

function normalizeStoredFilename(relativePath: string) {
  return relativePath.replace(/\\/g, "/").replace(/^\d+-[a-f0-9]+-/, "");
}

function inferTitle(content: string, fallback: string) {
  const heading = content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

function inferSource(relativePath: string) {
  return /^\d+-[a-f0-9]+-/.test(path.basename(relativePath)) ? "web_upload" : "builtin_rag";
}

function isUserKnowledgeDocument(document: KnowledgeDocument) {
  return ["web_upload", "web_page", "upload", "uploads", "user_upload"].includes(String(document.source || "").toLowerCase())
    || document.filename.startsWith("uploads/");
}

function inferTags(filename: string, content: string) {
  const text = `${filename}\n${content}`.toLowerCase();
  const tags = new Set<string>();
  const rules: Array<[RegExp, string]> = [
    [/embex|react|main\.cpp|agent/, "embex"],
    [/platformio|platform|board|framework/, "platformio"],
    [/gpio|pin|引脚|strapping|boot/, "gpio"],
    [/esp32-c3|esp32c3|c3/, "esp32-c3"],
    [/esp32-s3|esp32s3|s3/, "esp32-s3"],
    [/esp8266|nodemcu/, "esp8266"],
    [/oled|ssd1306|sh1106|u8g2/, "oled"],
    [/dht11|dht22|aht20|温湿度|sensor/, "sensor"],
    [/led|buzzer|蜂鸣器/, "actuator"],
    [/burn|upload|烧录|serial|串口|watchdog|brownout|故障|失败/, "diagnosis"]
  ];
  for (const [pattern, tag] of rules) {
    if (pattern.test(text)) tags.add(tag);
  }
  return [...tags];
}

function splitMarkdownSections(text: string) {
  if (!text) return [];
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line) && current.length) {
      sections.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) sections.push(current.join("\n").trim());
  return sections.filter(Boolean);
}

function expandQueryTerms(query: string) {
  const base = tokenize(query);
  const expanded = new Set(base);
  for (const term of base) {
    if (/[\u4e00-\u9fa5]{3,}/.test(term)) {
      for (let index = 0; index < term.length - 1; index += 1) {
        expanded.add(term.slice(index, index + 2));
      }
    }
  }
  const normalized = normalizeSearchText(query);
  const synonyms: Array<[RegExp, string[]]> = [
    [/烧录|upload|flash/, ["upload", "burn", "烧录"]],
    [/串口|serial|com\d*/i, ["serial", "串口", "monitor"]],
    [/屏幕|显示|oled/i, ["oled", "display", "显示"]],
    [/温湿度|dht|aht|sensor/i, ["sensor", "dht11", "aht20", "温湿度"]],
    [/蜂鸣器|buzzer|beep/i, ["buzzer", "蜂鸣器", "tone"]],
    [/引脚|gpio|pin/i, ["gpio", "pin", "引脚"]]
  ];
  for (const [pattern, words] of synonyms) {
    if (pattern.test(normalized) || pattern.test(query)) {
      words.forEach((word) => expanded.add(normalizeSearchText(word)));
    }
  }
  return [...expanded].filter(Boolean);
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function selectDiverseHits<T extends KnowledgeChunk & { score?: number }>(hits: T[], limit: number) {
  const selected: T[] = [];
  const perDocument = new Map<string, number>();
  for (const hit of hits) {
    const count = perDocument.get(hit.document_id) || 0;
    if (count >= 2) continue;
    selected.push(hit);
    perDocument.set(hit.document_id, count + 1);
    if (selected.length >= limit) return selected;
  }
  for (const hit of hits) {
    if (selected.includes(hit)) continue;
    selected.push(hit);
    if (selected.length >= limit) return selected;
  }
  return selected;
}

function normalizeTags(tags: unknown) {
  return Array.isArray(tags) ? tags.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function sanitizeFilename(value: string) {
  const cleaned = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return cleaned || "knowledge.md";
}

function sanitizeSection(value: string) {
  const cleaned = value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_").trim())
    .filter(Boolean)
    .join("/");
  return cleaned || "uploads";
}

function extensionOf(filename: string) {
  return path.extname(filename).replace(/^\./, "").toLowerCase() || "txt";
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
