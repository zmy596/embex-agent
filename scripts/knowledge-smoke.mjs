import { listKnowledgeFiles, reindexKnowledge, searchKnowledge } from "../server/knowledge/ragStore.ts";

const reindex = await reindexKnowledge();
const files = await listKnowledgeFiles();
const search = await searchKnowledge("ESP32-C3 OLED SPI RES DC", 3);

if (!reindex.success || files.total < 10 || search.hits.length === 0) {
  console.error(JSON.stringify({ reindex, files, search }, null, 2));
  process.exit(1);
}

const filenames = search.hits.map((hit) => hit.filename);
if (!filenames.some((name) => name.includes("oled") || name.includes("luatos"))) {
  console.error(JSON.stringify({ filenames, search }, null, 2));
  throw new Error("Expected OLED or LuatOS knowledge to be searchable");
}

console.log(JSON.stringify({
  success: true,
  file_count: files.total,
  chunk_count: reindex.chunks,
  retrieval: search.retrieval,
  top_hit: search.hits[0]?.filename,
  score: search.hits[0]?.score
}, null, 2));
