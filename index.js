import puppeteer from 'puppeteer';
import GameManipulator from './GameManipulator.js';
import UI from './UI.js';
import Learner from './Learner.js';

(async () => {
  // Lança o browser
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // Substitua pelo caminho correto
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  // Use DevTools Protocol para navegar até chrome://dino/
  const client = await page.target().createCDPSession();
  await client.send('Page.navigate', { url: 'chrome://dino/' });

  try {
    // Aguarda o canvas do jogo estar disponível
    await page.waitForSelector('canvas.runner-canvas', { timeout: 100000 });
    
  } catch (error) {
    console.error('Falha ao carregar o jogo:', error);
    await browser.close();
    process.exit(1);
  }

  // Initialize UI
  await UI.init(GameManipulator, Learner, page);

  // Initialize Game
  await GameManipulator.init(page, UI)

  // Initialize Learner
  await Learner.init(GameManipulator, UI, 12, 4, 0.25);

  // Configura leitura de sensores e estado do jogo
  setInterval(() => GameManipulator.readSensors(page), 40);
  setInterval(() => GameManipulator.readGameState(page), 200);

    // Opcional: Registrar logs do navegador
    // page.on('console', (msg) => {
    //   Learner.UI.logger(`BROWSER LOGGER: ${msg.text()}`);
    // });
})();
