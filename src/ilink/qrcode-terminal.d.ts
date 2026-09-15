declare module "qrcode-terminal" {
  const qrcode: { generate(content: string, options?: { small?: boolean }): void };
  export default qrcode;
}
