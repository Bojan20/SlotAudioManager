const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const htmlPath = path.join(__dirname, 'technical-architecture.html');
  const pdfPath = path.join(__dirname, 'SlotAudioManager-Technical-Architecture.pdf');

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 30000 });

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    displayHeaderFooter: false,
    preferCSSPageSize: true
  });

  await browser.close();
  console.log('✓ PDF generated:', pdfPath);
})();
