import puppeteer from 'puppeteer';
import GameManipulator from './GameManipulator.js';
import UI from './UI.js';
import Learner from './Learner.js';

// Função recursiva para aguardar o canvas do jogo
async function waitForCanvasRecursive(page) {
  const element = await page.$('canvas.runner-canvas');
  if (element) {
    return element;
  } else {
    console.log('Canvas not found, try again...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // wait 1 second
    return await waitForCanvasRecursive(page);
  }
}

(async () => {

  /** 
   * Examples executablePath
   * Windows 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
   * Linux: '/usr/bin/google-chrome'
   **/
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', //change to your S.O 
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    timeout: 0
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  // Use DevTools Protocol to navigate chrome://dino/
  const client = await page.target().createCDPSession();
  await client.send('Page.navigate', { url: 'chrome://dino/' });

  try {
    // wait game is ready
    await waitForCanvasRecursive(page);
  } catch (error) {
    console.error('Falha ao carregar o jogo:', error);
    await browser.close();
    process.exit(1);
  }

  // Initialize UI
  await UI.init(GameManipulator, Learner, page);

  // Initialize Game
  await GameManipulator.init(page, UI);

  // Initialize Learner
  await Learner.init(GameManipulator, UI, 12, 4, 0.25);

  // Init UI
  UI.startRenderLoop();

  // Init listeners sensors
  setInterval(() => GameManipulator.readSensors(page), 40);
  setInterval(() => GameManipulator.readGameState(page), 200);


})();
