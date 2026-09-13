const decoder = new TextDecoder();
let pending = "";

console.error(JSON.stringify({ type: "ready", protocolVersion: 1 }));
await Bun.write(Bun.stdout, new Uint8Array(640));

for await (const chunk of Bun.stdin.stream()) {
  pending += decoder.decode(chunk, { stream: true });
  const lines = pending.split("\n");
  pending = lines.pop() ?? "";
  for (const line of lines) {
    if (!line) continue;
    const command = JSON.parse(line);
    const payload = command.type === "get_devices"
      ? [{ id: "default", name: "Default", isDefault: true }]
      : null;
    console.error(JSON.stringify({ id: command.id, type: "response", success: true, payload }));
    if (command.type === "shutdown") process.exit(0);
  }
}
