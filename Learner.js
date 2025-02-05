import * as tf from '@tensorflow/tfjs';

// Enable production mode to optimize performance
// This disables debugging features to improve execution speed
// but may make debugging more difficult
// You should only enable this in production
tf.enableProdMode();

const Learn = {
  genomes: [], // Stores the different neural networks (genomes) being trained
  state: 'STOP', // Learning state: 'STOP' means it's not currently training
  genome: 0, // Current genome index being evaluated
  generation: 0, // Current training generation count
};

/**
 * Initializes the learning system with parameters.
 * @param {Object} gameManip - The game manipulator instance.
 * @param {Object} ui - The UI instance.
 * @param {number} genomeUnits - The number of genomes (neural networks) per generation.
 * @param {number} selection - The number of best genomes to be selected for reproduction.
 * @param {number} mutationProb - The probability of mutation during reproduction.
 */
Learn.init = async (gameManip, ui, genomeUnits, selection, mutationProb) => {
  Learn.gm = gameManip;
  Learn.ui = ui;
  Learn.genome = 0;
  Learn.generation = 0;
  Learn.genomeUnits = genomeUnits;
  Learn.selection = selection;
  Learn.mutationProb = mutationProb;
};

/**
 * Starts the learning process by generating the first population and executing generations.
 * @param {Object} page - Puppeteer page instance.
 */
Learn.startLearning = async (page) => {
  try {
    // Inicia o jogo pressionando a barra de espaço
    await page.keyboard.press('Space');
    Learn.ui.logger.log('starting game with Loaded genomes');
 
    while (Learn.genomes.length < Learn.genomeUnits) {
      Learn.ui.logger.log('building new Genomes ' + Learn.genomes.length);
      Learn.genomes.push(Learn.buildGenome(4, 3)); 
    }
    await Learn.executeGeneration(page);
  } catch (error) {
    console.log(error);
  }
};

/**
 * get random element form array.
 * @param {Object} arr - Array of elemnts.
 * * @param {Object} label - only indentfy origin from call.
 */
Learn.getRandomElement = (arr, label = '') => {
  if (arr.length === 0) {
    Learn.ui.logger.log(`getRandomElement falhou: Nenhum elemento disponível para ${label}`);
    return null;
  }
  const element = arr[Math.floor(Math.random() * arr.length)];
  return element;
};

/**
 * Selects the best genomes based on fitness.
 * @param {number} selectN - The number of best genomes to select.
 * @returns {Array} - Array of the selected best genomes.
 */
Learn.selectBestGenomes = (selectN) => {
  let selected = Learn.genomes.sort((a, b) => b.fitness - a.fitness).slice(0, selectN);
  return selected;
};

/**
 * Executes a complete generation cycle: evaluation, selection, crossover, and mutation.
 * @param {Object} page - Puppeteer page instance.
 */
Learn.executeGeneration = async (page) => {
  try {
    if (Learn.state === 'STOP') return;
    Learn.generation++;
    Learn.ui.logger.log('Executing generation ' + Learn.generation);
    Learn.genome = 0;
        
    // Evaluate each genome by playing the game
    for (const genome of Learn.genomes) {
      await Learn.executeGenome(genome, page);
    }

    // Select best genomes
    Learn.genomes = Learn.selectBestGenomes(Learn.selection);
    Learn.ui.logger.log('Best genomes: ' + Learn.genomes.map((a) => a.fitness).join(','));

    // Clone best genomes to keep the strong ones
    const bestGenomes = await Promise.all(Learn.genomes.map(async (genome) => await Learn.cloneModel(genome)));

   // Perform crossover to generate new genomes
    while (Learn.genomes.length < Learn.genomeUnits - 2) {
      let genA = Learn.getRandomElement(bestGenomes, 'genA');
      let genB = Learn.getRandomElement(bestGenomes, 'genB');
      const crossedGenome = await Learn.crossOver(genA, genB, page);
      const newGenome = await Learn.mutate(crossedGenome);
      Learn.genomes.push(newGenome);
    }
      // Mutation-only reproduction for diversity
    while (Learn.genomes.length < Learn.genomeUnits) {
      let gen = Learn.getRandomElement(bestGenomes, 'gen');
      const newGenome = await Learn.mutate(gen);
      Learn.genomes.push(newGenome);
    }
    Learn.ui.logger.log('Completed generation ' + Learn.generation);

    // Repeat process for next generation
    await Learn.executeGeneration(page); 

  } catch (error) {
    console.log(error);
  }
};

/**
 * Executes a single genome (neural network) by processing sensor data and making decisions.
 * @param {tf.Sequential} genome - The neural network model to be executed.
 * @param {Object} page - Puppeteer page instance to interact with the game.
 */
Learn.executeGenome = async (genome, page) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (Learn.state === 'STOP') return;

      Learn.genome = Learn.genomes.indexOf(genome) + 1;

      Learn.ui.logger.log('Executing genome ' + Learn.genome);

      await Learn.gm.startNewGame(page, () => {
        page.evaluate((initWithSpeed) => {
          if (initWithSpeed) {
            Runner.instance_.currentSpeed = initWithSpeed;
          }
        }, Learn.gm.initWithSpeed);
        
        Learn.gm.onSensorData = async () => {
          // Collect sensor inputs
          const inputs = [
            Learn.gm.sensors[0].distance,
            Learn.gm.sensors[0].obstacleWidth,
            Learn.gm.sensors[0].obstacleHeight,
            //Learn.gm.sensors[0].dinoHeight,
            Learn.gm.sensors[0].speed,
          ];
          const inputTensor = tf.tensor2d([inputs], [1, inputs.length]);
          const outputTensor = await genome.predict(inputTensor);
          const outputs = (await outputTensor.arraySync())[0]; 

          Learn.gm.gameOutput = outputs;

          // Determine the action with the highest probability
          const actionIndex = outputs.indexOf(Math.max(...outputs));

          //Mapping action
          let action;
          if (actionIndex === 0) {
            action = "DOWN";
          } else if (actionIndex === 1) {
            action = "NORM";
          } else if (actionIndex === 2) {
            action = "JUMP";
          }

          // Send the action to the game
          await Learn.gm.setGameOutput(action, page);
          
          inputTensor.dispose();
          outputTensor.dispose();
        };
        Learn.gm.onGameEnd = (points) => {
          Learn.ui.logger.log('Genome ' + Learn.genome + ' ended. Fitness: ' + points);
          genome.fitness = points;
          Learn.gm.onSensorData = null;
          resolve();
        };
      });
    } catch (error) {
      console.log(error);
    }
  });
};


/**
 * Loads neural network models from a saved JSON file.
 * @param {Array} genomes - List of saved genomes.
 * @param {Boolean} deleteOthers - Whether to clear previous genomes.
 */
Learn.loadGenomes = async function (genomes, deleteOthers) {
  try {
    if (deleteOthers) {
      Learn.genomes = [];
    }
    let loaded = 0;
    for (let genomeData of genomes) {
      try {
        const model = tf.sequential();
        genomeData.config.layers.forEach((layer, index) => {
          model.add(tf.layers.dense({
            units: layer.config.units,
            activation: typeof layer.config.activation === "string" ? layer.config.activation : "relu",
            inputShape: index === 0 ? [4] : undefined, 
            useBias: layer.config.use_bias,
          }));
        });
        model.compile({
          optimizer: 'adam',
          loss: 'categoricalCrossentropy'
        });
        if (genomeData.weights) {
          const weightTensors = genomeData.weights.map(w => tf.tensor(w.values, w.shape));
          await model.setWeights(weightTensors);
        } else {
          Learn.ui.logger.log("model is empty.");
        }
        Learn.genomes.push(model);
        loaded++;
      } catch (error) {
        Learn.ui.logger.log("Error model process: " + error.message);
      }
    }
    const best = genomes.map((a) => a.fitness).join(',');
    Learn.ui.logger.log('Loaded ' + loaded + ' genomes: ' + best);
  } catch (error) {
    Learn.ui.logger.log(error);
  }
};

/**
 * Creates a new neural network (genome) with specified inputs and outputs.
 * @param {number} inputs - Number of input neurons.
 * @param {number} outputs - Number of output neurons.
 * @returns {Object} - A new TensorFlow.js sequential model.
 */
Learn.buildGenome = (inputs, outputs) => {
  try {
    if (inputs <= 0 || outputs <= 0) {
      throw new Error('Inputs and outputs must be positive integers.');
    }
    const model = tf.sequential();

    // First hidden layer with 4 neurons
    model.add(tf.layers.dense({
      inputShape: [inputs],
      units: 4,
      activation: 'relu',
    }));

    // Output layer with softmax activation for classification (3 actions: jump, crouch, normal)
    model.add(tf.layers.dense({
      units: outputs, // outputs = 3
      activation: 'softmax',
    }));

    // Compile model with Adam optimizer and categorical cross-entropy loss
    model.compile({
      optimizer: 'adam',
      loss: 'categoricalCrossentropy',
    });
    return model;
  } catch (error) {
    console.log(error);
  }
};

/**
 * Clones a given neural network model, keeping the same structure and weights.
 * @param {tf.Sequential} model - The model to be cloned.
 * @returns {tf.Sequential} - The cloned model.
 */
Learn.cloneModel = async (model) => {
  try {
    const newModel = tf.sequential();

    // Copy each layer from the original model
    model.layers.forEach((layer, index) => {
      newModel.add(tf.layers.dense({
        units: layer.units,
        activation: layer.activation,
        inputShape: index === 0 ? layer.batchInputShape.slice(1) : undefined,
        useBias: layer.useBias,
        kernelInitializer: layer.kernelInitializer,
        biasInitializer: layer.biasInitializer
      }));
    });

    // Copy the weights to the new model
    const weights = model.getWeights();
    const clonedWeights = weights.map(w => tf.clone(w));
    newModel.setWeights(clonedWeights);

    // Compile the new model
    newModel.compile({
      optimizer: tf.train.adam(),
      loss: model.loss || 'meanSquaredError',
    });

    return newModel;

  } catch (error) {
    console.error(error);
  }
};

/**
 * Performs a crossover between two neural network models by swapping weights at a random point.
 * @param {tf.Sequential} netA - First parent network.
 * @param {tf.Sequential} netB - Second parent network.
 * @param {Object} page - Puppeteer page instance for debugging if necessary.
 * @returns {tf.Sequential} - New neural network model resulting from crossover.
 */
Learn.crossOver = async (netA, netB, page) => {
  try {
     // Randomly swap the parent networks
    if (Math.random() > 0.5) {
      let tmp = netA;
      netA = netB;
      netB = tmp;
    }
    const weightsA = await netA.getWeights();
    const weightsB = await netB.getWeights();

     // Perform crossover at a random point
    const newWeights = await Promise.all(weightsA.map(async (weight, index) => {
      const tensorA = weight;
      const tensorB = weightsB[index];
      if (tensorA.size !== tensorB.size) {
        throw new Error("The tensors are not same length.");
      }
      const valuesA = await tensorA.data();
      const valuesB = await tensorB.data();
      const crossPoint = Math.floor(Math.random() * valuesA.length);
      const newValues = valuesA.map((val, idx) =>
        idx < crossPoint ? val : valuesB[idx]
      );
      return tf.tensor(newValues, tensorA.shape);
    }));

     // Create a new model with the crossed weights
    const newModel = tf.sequential();
    netA.layers.forEach((layer, index) => {
      newModel.add(tf.layers.dense({
        units: layer.units,
        activation: layer.activation,
        inputShape: index === 0 ? layer.batchInputShape.slice(1) : undefined,
      }));
    });

    await newModel.setWeights(newWeights);

    return newModel;

  } catch (error) {
    let netAInfo = netA ? { layers: netA.layers.length, units: netA.layers.map(layer => layer.units) } : "netA undfined";
    let netBInfo = netB ? { layers: netB.layers.length, units: netB.layers.map(layer => layer.units) } : "netB undefined";
    await page.evaluate((netAInfo, netBInfo) => {
      alert("Error Game paused.\n" +
            "netA: " + JSON.stringify(netAInfo) + "\n" +
            "netB: " + JSON.stringify(netBInfo));
    }, netAInfo, netBInfo);
    await page.waitForTimeout(99999999);
  }
};

/**
 * Mutates a given neural network by slightly modifying its weights.
 * @param {Object} net - Neural network to mutate.
 * @returns {Object} - Mutated neural network.
 */
Learn.mutate = async (net) => {
  try {
    const weights = await net.getWeights();
    const mutatedWeights = await Promise.all(weights.map(async (weight) => {
      const values = await weight.data();
      const mutatedValues = values.map((val) =>
        Math.random() < Learn.mutationProb ? val + (Math.random() - 0.5) * 0.1 : val
      );
      return tf.tensor(mutatedValues, weight.shape);
    }));
    await net.setWeights(mutatedWeights);
    return net;
  } catch (error) {
    console.log(error);
  }
};

export default Learn;
