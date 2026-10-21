export function log(message: string): void {
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  console.log(`${hh}:${mm}:${ss}  ${message}`);
}
