import { listSkills, setSkillEnabled } from "../server/skills/skillRegistry.ts";

const listed = await listSkills();
if (!listed.success || !Array.isArray(listed.skills) || listed.skills.length < 3) {
  throw new Error("Skill registry did not load expected skills");
}

const target = listed.skills.find((skill) => skill.name === "esp_pin_analyzer");
if (!target) {
  throw new Error("esp_pin_analyzer skill is missing");
}

await setSkillEnabled("esp_pin_analyzer", false);
const disabled = await listSkills();
const disabledTarget = disabled.skills.find((skill) => skill.name === "esp_pin_analyzer");
if (disabledTarget?.enabled !== false) {
  throw new Error("Failed to disable esp_pin_analyzer");
}

await setSkillEnabled("esp_pin_analyzer", true);
const enabled = await listSkills();
const enabledTarget = enabled.skills.find((skill) => skill.name === "esp_pin_analyzer");
if (enabledTarget?.enabled !== true) {
  throw new Error("Failed to re-enable esp_pin_analyzer");
}

console.log(JSON.stringify({
  success: true,
  skill_count: enabled.skills.length,
  enabled_count: enabled.skills.filter((skill) => skill.enabled).length,
  target: enabledTarget?.name,
  invocation: enabledTarget?.invocation
}, null, 2));
