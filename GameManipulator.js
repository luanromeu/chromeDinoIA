const GameManipulator = {
  // Maximum observed speed in the game
  maxSpeedObserved: 6.0, // is variable between 6.0 and 13.0 (mas speed the game)
  initWithSpeed: 13.0, //start treing with speed if have value, 
  // Stores points (successful jumps)
  points: 0,

  // Event listeners
  onGameEnd: null,
  onGameStart: null,
  onSensorData: null,

  // Game state (either "PLAYING" or "OVER")
  gamestate: "OVER",

  // Debugging flag
  debug: false,

  // Fixed ground level value (optional, if needed)
  groundLevel: undefined,

  // Sensor data structure containing key parameters
  sensors: [
    {
      lastValue: 1, // Previous sensor reading (1 = no obstacle detected)
      distance: 1, // Normalized distance to the next obstacle
      obstacleWidth: 0, // Normalized obstacle width
      obstacleHeight: 0, // Normalized obstacle height
      speed: 0, // Normalized game speed
      dinoHeight: 0, // Normalized dinosaur height
      value: 1, // Internal consistency measure
    },
  ],
};

/**
 * Initializes the game manipulator by retrieving dinosaur information and disabling game pauses.
 ** @param {Object} page - Puppeteer page instance to interact with the game.
 */
GameManipulator.init = async (page, ui) => {
  GameManipulator.ui = ui;
  GameManipulator.getDinoInfo(page);
  // Desativa pausas automáticas do jogo
  return await page.evaluate(() => {
    if (typeof Runner !== "undefined" && Runner.instance_) {
      Runner.instance_.onVisibilityChange = () => {};
      Runner.instance_.onBlur = () => {};
    }
  });
};

/**
* Reads the current game state (either OVER or PLAYING).
 ** @param {Object} page - Puppeteer page instance to interact with the game.
*/
GameManipulator.readGameState = async (page) => {
  const { isGameOver } = await page.evaluate(() => {
    if (typeof Runner !== "undefined" && Runner.instance_) {
      return { isGameOver: Runner.instance_.crashed };
    }
    return { isGameOver: false };
  });

  if (isGameOver && GameManipulator.gamestate !== "OVER") {
    GameManipulator.gamestate = "OVER";
    await GameManipulator.setGameOutput("NORM", page);
    if (GameManipulator.onGameEnd) {
      GameManipulator.onGameEnd(GameManipulator.points);
      GameManipulator.onGameEnd = null;
    }
  } else if (!isGameOver && GameManipulator.gamestate !== "PLAYING") {
    GameManipulator.gamestate = "PLAYING";
    GameManipulator.points = 0;
    GameManipulator.lastScore = 0;
    await GameManipulator.setGameOutput("NORM", page);
    // Restart sensors
    const sensor = GameManipulator.sensors[0];
    sensor.lastValue = 1;
    sensor.value = 1;
    sensor.distance = 1;
    sensor.obstacleWidth = 0;
    sensor.obstacleHeight = 0;
    sensor.obstacleLength = 0;
    sensor.speed = 0;
    sensor.dinoHeight = 0;
    GameManipulator.lastOutputSet = "NONE";
    if (GameManipulator.onGameStart) {
      GameManipulator.onGameStart();
      GameManipulator.onGameStart = null;
    }
  }
};

/**
 * Retrieves dinosaur information (height and position) and determines the ground level.
 ** @param {Object} page - Puppeteer page instance to interact with the game.
 */
GameManipulator.getDinoInfo = async (page) => {
  const runnerData = await page.evaluate(() => {
    if (typeof Runner !== "undefined" && Runner.instance_) {
      const tRex = Runner.instance_.tRex;
      const dinoHeight = tRex.config.HEIGHT;
      const dinoY = tRex.yPos;
      return {
        dinoHeight,
        dinoY,
      };
    }
  });

  if (runnerData) {
    // Calcula o nível do solo: posição vertical do dinossauro + sua altura
    GameManipulator.groundLevel = runnerData.dinoY + runnerData.dinoHeight;
    GameManipulator.ui.logger.log(
      "groundLevel is " + GameManipulator.groundLevel
    );
  } else {
    GameManipulator.ui.logger.log(
      "Não foi possível obter os dados do dinossauro."
    );
  }
};


/**
 * Starts a new game by simulating a spaceb ar press.
 ** @param {Object} page - Puppeteer page instance to interact with the game.
 ** @param {Function} next - Callback function.
 */
let _startKeyInterval;
GameManipulator.startNewGame = async (page, next) => {
  await GameManipulator.readGameState(page);
  if (GameManipulator.gamestate == "OVER") {
    clearInterval(_startKeyInterval);
    GameManipulator.onGameStart = () => {
      clearInterval(_startKeyInterval);
      next && next();
    };
    _startKeyInterval = setInterval(() => {
      page.keyboard.press("Space");
    }, 300);
    await GameManipulator.readGameState(page);
  } else {
    GameManipulator.onGameEnd = () => {
      GameManipulator.startNewGame(page, next);
    };
  }
};

/**
 * Computes points based on successful obstacle avoidance.
 */
GameManipulator.computePoints = async () => {
  for (const sensor of GameManipulator.sensors) {
    // If sensor detect obstacle (value less than 1) and have one transition (lastValue close 1)
    if (sensor.distance > 0.5 && sensor.lastValue < 0.3) {
      GameManipulator.points++;
    }
  }
};

/**
 * Reads sensor data from the game, including obstacle detection and speed.
 ** @param {Object} page - Puppeteer page instance to interact with the game.
 */
GameManipulator.readSensors = async (page) => {
  try {
    const runnerData = await page.evaluate(() => {
      if (typeof Runner === "undefined" || !Runner.instance_) return null;
      const runner = Runner.instance_;
      const offset = [runner.tRex.xPos, runner.tRex.yPos];
      const dinoWidth = runner.tRex.config.WIDTH;
      const dinoHeight = runner.tRex.config.HEIGHT;
      const obstacles = runner.horizon.obstacles.map((obs) => ({
        xPos: obs.xPos,
        yPos: obs.yPos,
        width: obs.width,
        height: obs.height !== undefined ? obs.height : 0,
      }));
      const gameWidth = document.querySelector("runner-canvas")?.width || 600;
      return {
        speed: runner.currentSpeed,
        distanceRan: runner.distanceRan,
        crashed: runner.crashed,
        obstacles,
        gameWidth,
        offset,
        dinoWidth,
        dinoHeight,
      };
    });

    if (!runnerData) {
      GameManipulator.ui.logger.log("Runner instance not found!");
      return;
    }

    const groundLevel = GameManipulator.groundLevel;
    const sensor = GameManipulator.sensors[0];
    const maxDistance = runnerData.gameWidth * 0.7;
    const { speed, obstacles, dinoWidth, dinoHeight, crashed } = runnerData;

    if (crashed && sensor.distance > 0) {
      sensor.distance = 0.0;
      return;
    }

    const marginOffset = dinoWidth * 0.3;

    if (obstacles.length > 0) {
      // Selects the nearest obstacle based on horizontal distance
      const nearestObstacle = obstacles.reduce((closest, obs) => {
        const distX = obs.xPos - (runnerData.offset[0] + marginOffset);
        return distX > 0 &&
          distX < (closest?.xPos - runnerData.offset[0] || Infinity)
          ? obs
          : closest;
      }, null);

      if (nearestObstacle) {
       // Calculates the raw distance between the obstacle and the dinosaur
        let rawDistance = nearestObstacle.xPos - (runnerData.offset[0] + marginOffset);
        rawDistance = Math.max(0, Math.min(rawDistance, maxDistance));
        sensor.distance = rawDistance / maxDistance;
      
        // Normalization of obstacle width:
        // Defines a maximum expected value for the obstacle's width.
        // Example: If obstacles are usually slightly larger than the dinosaur, a factor of 1.2 is used.
        const maxObstacleWidth = runnerData.dinoWidth * 1.2;
        sensor.obstacleWidth = Math.max(0, Math.min(1, nearestObstacle.width / maxObstacleWidth));
        sensor.obstacleHeight = (groundLevel - (nearestObstacle.yPos + nearestObstacle.height)) / dinoHeight;
      
        // Speed normalization:
        sensor.speed = speed / GameManipulator.maxSpeedObserved;
      
        // Calculation of the dinosaur's height (dinoHeight):
        // If the dinosaur is on the ground, groundLevel - runnerData.offset[1] should be approximately equal to dinoHeight.
        // Thus, the normalized value will be 0; otherwise, it will be greater than 0.
        sensor.dinoHeight = (groundLevel - runnerData.offset[1] - dinoHeight) / dinoHeight;
      
        // Determines if the obstacle is a bird (an airborne obstacle).
        if (sensor.lastValue > 0.98 && sensor.distance < 0.98) {
         // If the relative height of the obstacle is greater than a threshold (e.g., 0.2), it is considered to be in the air.
          sensor.isBird = sensor.obstacleHeight > 0.2;
        }
      } else {
        // No obstacle detected: default values.
        sensor.distance = 1.0;
        sensor.obstacleWidth = 0.0;
        sensor.obstacleHeight = 0.0;
        sensor.obstacleLength = 0.0;
        sensor.speed = speed / GameManipulator.maxSpeedObserved;
        sensor.dinoHeight = 0;
        sensor.isBird = false;
      }
      
    } else {
      sensor.distance = 1.0;
      sensor.obstacleWidth = 0.0;
      sensor.obstacleHeight = 0.0;
      sensor.obstacleLength = 0.0;
      sensor.speed = speed / GameManipulator.maxSpeedObserved;
      sensor.dinoHeight =
        (runnerData.offset[1] +
          dinoHeight -
          runnerData.offset[1] -
          dinoHeight) /
        dinoHeight;
      sensor.isBird = false;
    }

    await GameManipulator.computePoints();

    // Update sensor.lastValue to next interation
    sensor.lastValue = sensor.distance;

    if (GameManipulator.onSensorData) {
      GameManipulator.onSensorData();
    }

    GameManipulator.runnerData = runnerData;

    if (GameManipulator.debug) {
      await page.evaluate(
        (sensors, runnerData, marginOffset) => {
          const gameCanvas = document.querySelector("canvas.runner-canvas");
          if (!gameCanvas) {
            console.error("Canvas do jogo não encontrado.");
            return;
          }
          let overlay = document.getElementById("debugOverlay");
          if (!overlay) {
            overlay = document.createElement("canvas");
            overlay.id = "debugOverlay";
            overlay.width = gameCanvas.width;
            overlay.height = gameCanvas.height;
            const gameRect = gameCanvas.getBoundingClientRect();
            overlay.style.position = "absolute";
            overlay.style.left = gameRect.left + "px";
            overlay.style.top = gameRect.top + "px";
            overlay.style.pointerEvents = "none";
            overlay.style.zIndex = "1000";
            document.body.appendChild(overlay);
          }
          const ctx = overlay.getContext("2d");
          const originX = runnerData.offset[0] + marginOffset;
          const originY = runnerData.offset[1];
          const maxDistanceScale = 400;
          const sensorSizeScale = 50;
          const sensor = sensors[0];
          ctx.clearRect(0, 0, overlay.width, overlay.height);
          ctx.fillStyle = "cyan";
          ctx.beginPath();
          ctx.arc(originX, originY, 5, 0, 2 * Math.PI);
          ctx.fill();
          const endX = originX + sensor.distance * maxDistanceScale;
          const endY = originY;
          ctx.strokeStyle = "lime";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(originX, originY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          const circleRadius = sensor.obstacleWidth * sensorSizeScale;
          ctx.fillStyle = "red";
          ctx.beginPath();
          ctx.arc(endX, endY, circleRadius, 0, 2 * Math.PI);
          ctx.fill();
          ctx.font = "16px Arial";
          ctx.fillStyle = "yellow";
          ctx.fillText("Distance: " + sensor.distance.toFixed(2), 10, 20);
          ctx.fillText("ObsWidth: " + sensor.obstacleWidth.toFixed(2), 10, 40);
          ctx.fillText(
            "ObsHeightRel: " + sensor.obstacleHeight.toFixed(2),
            10,
            60
          );
          ctx.fillText(
            "ObsLength: " + sensor.obstacleLength.toFixed(2),
            10,
            80
          );
          ctx.fillText("Speed: " + sensor.speed.toFixed(2), 10, 100);
          ctx.fillText("DinoJump: " + sensor.dinoHeight.toFixed(2), 10, 120);
          ctx.fillStyle = "white";
          ctx.fillText("Activation", endX + 5, endY - 5);
          requestAnimationFrame(function updateOverlay() {
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            const newEndX = originX + sensor.distance * maxDistanceScale;
            const newEndY = originY;
            ctx.fillStyle = "cyan";
            ctx.beginPath();
            ctx.arc(originX, originY, 5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = "lime";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(originX, originY);
            ctx.lineTo(newEndX, newEndY);
            ctx.stroke();
            const newCircleRadius = sensor.obstacleWidth * sensorSizeScale;
            ctx.fillStyle = "red";
            ctx.beginPath();
            ctx.arc(newEndX, newEndY, newCircleRadius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.font = "16px Arial";
            ctx.fillStyle = "yellow";
            ctx.fillText("Distance: " + sensor.distance.toFixed(2), 10, 20);
            ctx.fillText(
              "ObsWidth: " + sensor.obstacleWidth.toFixed(2),
              10,
              40
            );
            ctx.fillText(
              "ObsHeightRel: " + sensor.obstacleHeight.toFixed(2),
              10,
              60
            );
            ctx.fillText(
              "ObsLength: " + sensor.obstacleLength.toFixed(2),
              10,
              80
            );
            ctx.fillText("Speed: " + sensor.speed.toFixed(2), 10, 100);
            ctx.fillText("DinoJump: " + sensor.dinoHeight.toFixed(2), 10, 120);
            ctx.fillStyle = "white";
            ctx.fillText("Activation", newEndX + 5, newEndY - 5);
            requestAnimationFrame(updateOverlay);
          });
        },
        GameManipulator.sensors,
        runnerData,
        runnerData.dinoWidth * 0.3
      );
    }
  } catch (error) {
    console.log("Error in GameManipulator.readSensors:", error);
  }
};


GameManipulator.lastOutputSet = "NONE";
GameManipulator.lastOutputSetTime = 0;
/**
 * Sets the game output action based on the neural network's decision.
 ** @param {String} page - Action from neural network.
 ** @param {Object} page - Puppeteer page instance to interact with the game.
 */
GameManipulator.setGameOutput = async (action, page) => {
  if (typeof action !== "string") {
    throw new Error("Invalid action: must be a string.");
  }
  
  // Update action
  GameManipulator.gameOutputString = action;
  
  if (action === "DOWN") {
    if (GameManipulator.lastOutputSet !== "DOWN") {
      await page.keyboard.up("ArrowUp");
      await page.keyboard.down("ArrowDown");
    }
  } else if (action === "NORM") {
    if (GameManipulator.lastOutputSet !== "NORM") {
      await page.keyboard.up("ArrowUp");
      await page.keyboard.up("ArrowDown");
    }
  } else if (action === "JUMP") {
    const jumpDuration = 200; // time jump (200 ms)
    if (Date.now() - GameManipulator.lastOutputSetTime > jumpDuration) {
      GameManipulator.lastOutputSetTime = Date.now();
      await page.keyboard.down("ArrowUp");
      await page.keyboard.up("ArrowDown");
      setTimeout(async () => {
        await page.keyboard.up("ArrowUp");
      }, jumpDuration);
    }
  }
  
  GameManipulator.lastOutputSet = action;
};


export default GameManipulator;
