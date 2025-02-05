import contrib from 'blessed-contrib';
import blessed from 'blessed';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Necessary adjustment for ESM (__dirname equivalent)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const screen = blessed.screen();

const UI = {};

/**
 * Saves the current genomes to a JSON file.
 */
const savegame = () => {
  try {
    let jsonGenomes = [];
    for (let k in UI.learner.genomes) {
      let model = UI.learner.genomes[k];
      let modelConfig = {
        class_name: "Sequential",
        config: {
          name: model.name || `genome_${k}`,
          layers: model.layers.map((layer, index) => {
            let activation = typeof layer.activation === "string" ? layer.activation : "relu";
            if (index === model.layers.length - 1) {
              activation = "softmax";
            }
            return {
              class_name: "Dense",
              config: {
                units: layer.units,
                activation: activation,
                use_bias: layer.useBias,
                inputShape: index === 0 ? layer.inputShape : undefined,
              }
            };
          })
        }
      };
      let weights = model.getWeights();
      let weightValues = weights.map(tensor => ({
        values: tensor.arraySync(),
        shape: tensor.shape
      }));
      modelConfig.weights = weightValues;
      jsonGenomes.push(modelConfig);
    }
    UI.logger.log(`Saving ${jsonGenomes.length} genomes...`);
    const dir = path.join(__dirname, 'genomes');
    const fileName = `${dir}/gen_${UI.learner.generation}_${Date.now()}.json`;
    fs.writeFileSync(fileName, JSON.stringify(jsonGenomes, null, 2));
    UI.logger.log(`✅ Saved to ${fileName}`);
    UI.refreshFiles();
  } catch (err) {
    UI.logger.log(`❌ Failed to save: ${err.message}`);
  }
};

/**
 * Initializes the UI components.
 */
UI.init = async (gameManipulator, learner, page) => {
  UI.gm = gameManipulator;
  UI.learner = learner;

  UI.grid = new contrib.grid({
    rows: 12,
    cols: 6,
    screen: screen
  });

 // Builds the sensor input bar chart
   UI.uiSensors = UI.grid.set(0, 0, 3, 6, contrib.bar, {
    label: 'Network Inputs',
    // bg: 'white',
    barWidth: 12,
    barSpacing: 1,
    xOffset: 0,
    maxHeight: 100,
  });


// Log box
  UI.logger = UI.grid.set(3, 0, 3, 6, contrib.log, {
    fg: 'green',
    selectedFg: 'green',
    label: 'Logs'
  });

   // Displays game statistics
  UI.uiScore = UI.grid.set(6, 0, 3, 3, blessed.Text, {
    label: 'Game Stats',
    fg: 'white',
    content: 'Loading...',
    align: 'center',
  });

   // Displays genome statistics
  UI.uiGenomes = UI.grid.set(6, 3, 3, 3, blessed.Text, {
    label: 'Genome Stats',
    fg: 'white',
    content: 'Hey!',
    align: 'center',
  });

// File tree for saved genomes
  UI.savesTree = UI.grid.set(9, 0, 3, 3, contrib.tree, {
    label: 'Saved Genomes',
  });

  // Callback for selecting a genome file
  screen.key(['l', 'L'], UI.savesTree.focus.bind(UI.savesTree));
  UI.savesTree.on('click', UI.savesTree.focus.bind(UI.savesTree));
  UI.savesTree.on('select', (item) => {
    if (item.isFile) {
      let fileName = item.name;
      UI.logger.log(`Loading genomes from file: ${fileName}`);
      try {
        const filePath = path.join(__dirname, 'genomes', fileName);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const genomes = JSON.parse(fileContent);
        UI.learner.loadGenomes(genomes);
      } catch (error) {
        UI.logger.log(`❌ Error loading genome file: ${error.message}`);
      }
    } else {
      UI.refreshFiles();
    }
  });

  UI.refreshFiles();

   // Save button
  UI.btnSave = UI.grid.set(9, 3, 3, 3, blessed.box, {
    label: 'Save to File',
    bg: 'green',
    fg: 'red',
    content: '\n\n\n\nSave Genomes',
    align: 'center',
  });

  UI.btnSave.on('click', () => {
    savegame();
  });

  screen.key(['o', 'O'], () => {
    savegame();
  });

  screen.key(['escape', 'q', 'C-c'], (ch, key) => {
    return process.exit(0);
  });

  screen.key(['s'], (ch, key) => {
    if (learner.state === 'STOP') {
      learner.state = 'LEARNING';
      learner.startLearning(page);
    } else {
      learner.state = 'STOP';
    }
  });

  screen.render();
};

/**
 * Refreshes the list of saved genome files.
 */
UI.refreshFiles = () => {
  var fileData = {
    name: 'Saved Files',
    extended: true,
    children: [{
      name: 'Refresh Folders'
    }]
  };

  UI.logger.log('Reading genomes dir...');
  var files = fs.readdirSync('./genomes');
  for (var k in files) {
    if (files[k].indexOf('.json') >= 0) {
      fileData.children.push({
        name: files[k],
        isFile: true,
      });
    }
  }
  UI.savesTree.setData(fileData);
};

/**
 * Updates and renders the UI with the latest sensor and game data.
 */
UI.render = () => {
UI.uiSensors.setData({
  titles: ['Distance', 'ObsWidth', 'ObsHeight', 'Speed'],
  data: [
    Math.round(UI.gm.sensors[0].distance * 100),
    Math.round(UI.gm.sensors[0].obstacleWidth * 100),
    Math.round(UI.gm.sensors[0].obstacleHeight * 100),
    Math.round(UI.gm.sensors[0].speed * 100),
    // Se gameOutput for um array, exibe os 3 valores; caso contrário, exibe o valor diretamente.
    // Array.isArray(UI.gm.gameOutput)
    //   ? UI.gm.gameOutput.map(val => Math.round(val * 100)).join(' | ')
    //   : "N/A"
  ]
});

  // update statistics of game and genomes
  let learn = UI.learner;
  let uiStats = '';
  uiStats += 'Status: ' + learn.state + '\n';
  uiStats += 'Fitness: ' + UI.gm.points + '\n';
  uiStats += 'GameStatus: ' + UI.gm.gamestate + '\n';
  uiStats += 'Generation: ' + learn.generation;
  uiStats += ' : ' + learn.genome + '/' + learn.genomes.length;
  UI.uiScore.setText(uiStats);

  if (UI.gm.gameOutput) {
    let str = '';
    str += 'Action: ' + UI.gm.gameOutputString + '\n';
    str += 'Activation: ' + UI.gm.gameOutput[0] + " - " + UI.gm.gameOutput[1] + " - " + UI.gm.gameOutput[2]  ;
    UI.uiGenomes.setText(str);
  } else {
    UI.uiGenomes.setText('Loading...');
  }

  screen.render();
};

/**
 * Starts the continuous render loop.
 * Call this function after UI.init is completed.
 */
UI.startRenderLoop = () => {
  setTimeout(() => {
    setInterval(UI.render, 25);
  }, 10000);
};


export default UI;
