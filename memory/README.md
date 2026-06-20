# Embex Memory Runtime Data

This directory stores local persistent memory generated while Embex runs.

- `memory_state.json`: compressed memory, hardware state, project facts, and preferences.
- `conversation_log.jsonl`: raw conversation turns.
- `project_facts.json`: extracted project facts.

These files are intentionally ignored by Git because they contain local session
state and smoke tests may rewrite them. Use export features or curated docs when
you need to preserve knowledge as project material.
