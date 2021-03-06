var brain = require('brain.js');
var fs = require('fs');
var colors = require('colors');

module.exports = {
  run: function (klyng) {
    return new Promise ((resolve, reject) => {
      const layers = [5, 5, 5];
      const net = new brain.NeuralNetwork ({
        hiddenLayers: layers,
        timeout: Infinity,
        callbackPeriod: 10
      });

      net.train({ input: fuzz(a), output: { a: 1, b: 0, c: 0 } });
      let json = net.toJSON();

      var partition = Math.floor(trainSet.length / klyng.size());
      
      for (var p = 1; p < klyng.size(); ++p) {
        sendTask(klyng, p, json, trainSet.slice((p - 1) * partition, p * partition));
      }

      let promises = [];
      promises.push(
        trainMe(klyng, net, trainSet.slice(0, partition))
          .then (sanityCheckFirstNetwork)
      );
      for (var p = 1; p < klyng.size(); ++p) {
        promises.push(listenForResults(klyng, p));
      }

      return Promise
        .all(promises)
        .then(handleResults)
        .then(combineNetworks)
        .then(testNewNetwork)
        .catch(err => {
          log(`${klyng.rank()}`.red + ` error => ${err.stack}`.gray);
          reject(err);
        });
    })
  }
};

function sendTask (klyng, rank, json, trainingData) {
  log(`sending task to ${rank}`.green)
  klyng.send({
    to: rank,
    data: JSON.stringify({
      json: json,
      trainingData: trainingData
    })
  });
  log(`task sent to ${rank}`.green)
}

function trainMe (klyng, net, trainingData) {
  return new Promise((resolve, reject) => {
    const trainRes = net.train(trainingData, { 
      callback: (res) => { log(`${klyng.rank()}`.red + ` training => [${res.iterations}, ${res.error}]`.gray); }
    });
    resolve({
      rank: 0,
      trainingData: trainingData,
      trainRes: trainRes,
      json: net.toJSON()
    });
  })
}

function sanityCheckFirstNetwork (res) {
  return new Promise((resolve, reject) => {
    var net = new brain.NeuralNetwork().fromJSON(res.json);
    count = 0;
    res.trainingData.forEach(d => {
      var r = net.run(d.input);
      
      if (getMax(r).key !== getMax(d.output).key) count++;
    })
    log (`${count} mistakes of ${res.trainingData.length}`.yellow);
    delete res.trainingData;
    resolve(res);
  })
}

function listenForResults (klyng, rank) {
  return new Promise ((resolve, reject) => {
    log(`listening for ${rank} results`);
    let results = klyng.recv();
    log(`recieved ${rank} results`);
    resolve(results);
  });
}

function handleResults(values) {
  return new Promise ((resolve, reject) => {
    log(`\n\t${values.map(v => {
      return '' + v.rank + ' => { iterations: ' + v.trainRes.iterations + ', error: ' + v.trainRes.error + '}'; 
    }).join('\n\t')}`.bgMagenta.black.bold);
    resolve(values.map(v => v.json));
  })
}

function combineNetworks (networks) {
  return new Promise ((resolve, reject) => {
    var newJson = {
      sizes: networks[0].sizes,
      layers: [networks[0].layers[0]], // input layer added cause it's blank
      outputLookup: networks[0].outputLookup,
      inputLookup: networks[0].inputLookup,
      trainOpts: networks[0].trainOpts
    }

    let outputLayerGroupings = []
    let netsHiddenLayers = networks.map(net => {
      let layersCopy = net.layers.concat([]);
      layersCopy.shift();// empty input layer
      return layersCopy;
    })

    let newLayers = []
    let newNetLayers = netsHiddenLayers.shift(); // take first network's results

    Object.keys(newNetLayers).forEach(iLayer => {
      Object.keys(newNetLayers[iLayer]).forEach(iNeuron => {
        for(var iNet = 0; iNet < netsHiddenLayers.length; ++iNet) {
          newNetLayers[iLayer][iNeuron].bias += netsHiddenLayers[iNet][iLayer][iNeuron].bias;
          Object.keys(newNetLayers[iLayer][iNeuron].weights).forEach(iWeight => {
            newNetLayers[iLayer][iNeuron].weights[iWeight] += netsHiddenLayers[iNet][iLayer][iNeuron].weights[iWeight];
          })
        }
      })
    });
    newJson.layers = newJson.layers.concat(newNetLayers);
    resolve(newJson);
  });
}

function testNewNetwork (json) {
  return new Promise ((resolve, reject) => {
    var net = new brain.NeuralNetwork().fromJSON(json)
    trainSet.forEach(v => {
      var results = net.run(v.input);
      var expected = getMax(v.output);
      var actual = getMax(results);
      (actual.key === expected.key) ? 
        console.log((`  ${actual.key} === ${expected.key} -> ${JSON.stringify(results)}`).green) :
        console.log((`  ${actual.key} !== ${expected.key} -> ${JSON.stringify(results)}`).red);
    })
    resolve();
  });
}

function getMax(res) {
  return Object.keys(res).reduce((result, key) => {
    if (!result) return { key: key, value: res[key] };
    if (result.value < res[key]) return {key: key, value: res[key] };
    return result;
  }, {key:'', value: -Infinity});
}

let a = character(
  '.#####.' +
  '#.....#' +
  '#.....#' +
  '#######' +
  '#.....#' +
  '#.....#' +
  '#.....#'
);
let b = character(
  '######.' +
  '#.....#' +
  '#.....#' +
  '######.' +
  '#.....#' +
  '#.....#' +
  '######.'
);
let c = character(
  '#######' +
  '#......' +
  '#......' +
  '#......' +
  '#......' +
  '#......' +
  '#######'
);

function character(string) {
  return string
    .trim()
    .split('')
    .map(integer);
}

/**
 * Return 0 or 1 for '#'
 * @param character
 * @returns {number}
 */
function integer(character) {
  if ('#' === character) return 1;
  return 0;
}

var trainSet = [];

for (var i = 0; i < 500; ++i) {
  switch(i%3) {
  case 0:
    trainSet.push({ input: fuzz(a), output: { a: 1, b: 0, c: 0} })
    break;
  case 1:
    trainSet.push({ input: fuzz(b), output: { a: 0, b: 1, c: 0} })
    break;
  case 2:
    trainSet.push({ input: fuzz(c), output: { a: 0, b: 0, c: 1} })
    break;
  }
}

function fuzz(input) {
  let result = Object.assign([], input);
  const count = Math.floor(Math.random() * 10);
  for (var i = 0; i < count; ++i) {
    let randIndex = Math.floor(Math.random() * result.length);
    result[randIndex] = (result[randIndex]) ? 0 : 1;  
  }
  return result;
}

function log (str) {
  var now = new Date();
  console.log(`[${now.getMinutes()}:${now.getSeconds()}:${now.getMilliseconds()}]`.gray + str);
}