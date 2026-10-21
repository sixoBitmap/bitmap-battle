declare module 'qrcode' {
  const QRCode: { toString(text: string, options?: { type?: 'terminal' | 'svg' | 'utf8'; small?: boolean }): Promise<string> };
  export default QRCode;
}
