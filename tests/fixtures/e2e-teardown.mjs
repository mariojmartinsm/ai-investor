export default async function teardown() {
  const authPort = process.env.E2E_AUTH_PORT ?? "54339";
  const response = await fetch(`http://127.0.0.1:${authPort}/__test/shutdown`, { method: "POST" });
  if (!response.ok) throw new Error("Unable to stop the isolated Auth fixture.");
  await response.json();
}
