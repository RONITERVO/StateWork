import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
const { name, bytes } = workerData as { name: string; bytes: Uint8Array };
try {
  let content = '';
  const warnings: string[] = [];
  if (/\.pdf$/i.test(name)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const root = import.meta.resolve('pdfjs-dist/package.json');
    const loading = getDocument({
      data: bytes,
      useSystemFonts: false,
      standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', root)).replaceAll('\\', '/'),
      cMapUrl: fileURLToPath(new URL('./cmaps/', root)).replaceAll('\\', '/'),
      cMapPacked: true,
    });
    const pdf = await loading.promise;
    try {
      if (pdf.numPages > 250) throw new Error('Select a document with at most 250 pages.');
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const text = await page.getTextContent();
        const line = text.items
          .map((i) => ('str' in i ? i.str + ('hasEOL' in i && i.hasEOL ? '\n' : ' ') : ''))
          .join('');
        content += `\n[Page ${p}]\n${line}\n`;
        if (!line.trim())
          warnings.push(`Page ${p} has no extractable text. Transcribe or describe its contents.`);
        if (content.length > 180000)
          throw new Error(
            'Text exceeds 180,000 characters. Split the document into named sections.',
          );
      }
    } finally {
      await loading.destroy();
    }
    warnings.push(
      'Text only: check diagrams, tables, page order and scanned text against the original.',
    );
  } else if (/\.docx$/i.test(name)) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    content = result.value;
    warnings.push(
      ...result.messages.map((m) => m.message),
      'Text only: check figures, tables, headers and layout against the original.',
    );
  } else if (/\.(txt|md|json|csv|eml|log|html?)$/i.test(name)) {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/\.eml$/i.test(name))
      warnings.push('Raw email: encoded bodies and attachments need a readable capture.');
  } else throw new Error('Use PDF, DOCX, UTF-8 text, Markdown, HTML, JSON, CSV or EML.');
  if (content.length > 180000)
    throw new Error('Text exceeds 180,000 characters. Split it into named sections.');
  parentPort?.postMessage({ content, warnings });
} catch (error) {
  parentPort?.postMessage({
    error: error instanceof Error ? error.message : 'Could not read this file.',
  });
}
