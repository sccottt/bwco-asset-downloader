
// Requires

const colors   = require('colors'),
      fq       = require('filequeue'),
      fs       = require('fs'),
      os       = require('os'),
      mkdirp   = require('mkdirp'),
      request  = require('request'),
      rimraf   = require('rimraf'),
      progress = require('request-progress'),
      readline = require('readline'),
      xhr      = require('xmlhttprequest'),
      argv     = require('minimist')(process.argv.slice(2));

const pkg      = require('./package.json'),
      config   = require(`./` + (argv.config ? argv.config : `config.json`));


// Constants

const TEMP_DL_FOLDER = "temp";


// Vars

var schemaIndex   = 0,
    sourceIndex   = 0,
    downloadIndex = 0;

var tempFolder    = '',
    downloadQueue = [],
    fileQueue     = new fq(1);

var jsonOnly      = argv.j || argv.json_only;


// Init

init();

function init() {

  initWelcome();

  output(``);
  outputMsgBox(`Setting up`);

  initFolders();

  output(``);
  outputMsgBox(`Processing sources`);

  processNextSchema();

}
function initWelcome() {

  output(``);

  output(`┌───────────────────────┐`.green);
  output(`│ `.green + `BWCo Asset Downloader` + ` │`.green + ` v${pkg.version}`);
  output(`└───────────────────────┘`.green);

  output(``);

  output(`Downloading assets for ${config.schemas.length} JSON schema(s)`);
  config.schemas.forEach((schema, i) => {
    output(`\n  Schema ${i + 1} sources`);
    schema.sources.forEach((source, j) => {
      output(`  - ${source.url}`.gray);
    })
  });

}
function initFolders() {

  output(`Setting up folders`);

  output(`  Creating temporary downloads folder "${TEMP_DL_FOLDER}/${Date.now()}/"... `.gray, true)
  tempFolder = `${TEMP_DL_FOLDER}/${Date.now()}`;
  mkdirp.sync(tempFolder);
  output(`✓`.green);

}


// Event handlers

function onSchemaComplete() {

  schemaIndex++;
  processNextSchema();

}
function onAllSchemasComplete() {

  if (jsonOnly) {
    onAllAssetsComplete();
  } else {
    downloadAssets();
  }

}

function onSourceComplete() {

  sourceIndex++;
  processNextSource();

}
function onAllSourcesComplete() {

  onSchemaComplete();

}

function onAssetComplete() {

  output(`✓`.green);

  downloadIndex++;
  downloadNextAsset();

}
function onAllAssetsComplete() {

  moveCompletedDownloads();

}
function onAssetError(err) {

  output(`Error loading asset: ${err}`.red);

}

function onAllAssetsMoved() {

  output(`\n  Clearing temporary downloads folder... `.gray, true);
  rimraf.sync(TEMP_DL_FOLDER);
  output(`✓`.green);

  output(``);
  output(`┌───┐`.green);
  output(`│ `.green + `✓` + ` │`.green + ` All assets downloaded. Great job!`);
  output(`└───┘`.green);
  output(``);

}


// Functions

function processNextSchema() {

  if (schemaIndex < config.schemas.length) {
    processSchema(config.schemas[schemaIndex]);
  } else {
    onAllSchemasComplete();
  }

}
function processSchema(schema) {

  sourceIndex = 0;

  processNextSource();

}

function processNextSource() {

  const schema = config.schemas[schemaIndex];

  if (sourceIndex < schema.sources.length) {
    processSource(schema.sources[sourceIndex], jsonOnly ? [] : schema.assets);
  } else {
    onAllSourcesComplete();
  }

}
function processSource(source, assets) {

  output(`Processing schema ${schemaIndex + 1}, source ${sourceIndex + 1}`);
  output(`  ${source.url}`.gray);
  output(``);

  let schemaFolder = `${tempFolder}/${schemaIndex}`,
      sourceFolder = schemaFolder + (source.targetFolder ? `/${source.targetFolder}` : ``),
      assetsFolder = sourceFolder + (assets && assets.length ? `/assets` : ``);

  output(`  Creating download folder '${assetsFolder}'... `.gray, true);
  mkdirp.sync(assetsFolder);
  output(`✓`.green);

  output(`  Loading JSON data from server... `.gray, true);
  let data = JSON.parse(loadJSON(source.url));
  output(`✓`.green);

  if (assets && assets.length) {
    output(`  Compiling asset paths... `.gray, true);
    assets.forEach((assetField, j) => {
      processAssetField(assetField.split('.'), data, sourceFolder, 'assets/');
    });
    output(`✓`.green);
  } else {
    output(`  No assets to download... `.gray + `✓`.green);
  }

  output(`  Writing JSON to local file... `.gray, true);
  fs.writeFileSync(`${sourceFolder}/${source.targetFilename}`, stringifyJSON(data));
  output(`✓`.green);

  output(``);

  onSourceComplete();

}

function processAssetField(fields, obj, basePath, outputPath) {

  let field           = fields[0],
      fieldsRemaining = fields.slice(1);

  outputPath += field;

  if (!fieldsRemaining.length) {
    if (obj[field]) {

      if (Array.isArray(obj[field])) {
        for (var i = 0; i < obj[field].length; i++) {

          let url       = obj[field][i],
              filename  = `${outputPath}-${i}.${getFileExtension(url)}`,
              fullPath  = `${basePath}/${filename}`;

          addToDownloadQueue(url, fullPath);

          obj[field][i] = filename;

        }
      } else {

        let url       = obj[field],
            filename  = `${outputPath}.${getFileExtension(url)}`,
            fullPath  = `${basePath}/${filename}`;

        addToDownloadQueue(url, fullPath);

        obj[field]    = filename;

      }

    }

  } else if (obj[field]) {

    if (Array.isArray(obj[field])) {
      for (var i = 0; i < obj[field].length; i++) {
        processAssetField(fieldsRemaining, obj[field][i], basePath, `${outputPath}-${i}-`);
      }

    } else {
      processAssetField(fieldsRemaining, obj[field], basePath, `${outputPath}-`);
    }

  }

}

function addToDownloadQueue(url, localPath) {

  let item = downloadQueue.find((el) => (el.url === url));

  if (item) {
    item.localPaths.push(localPath);
  } else {
    downloadQueue.push({
      url: url,
      localPaths: [
        localPath
      ]
    })
  }

}

function downloadAssets() {

  outputMsgBox(`Downloading assets`)

  downloadNextAsset();

}

function downloadNextAsset() {

  if (downloadIndex < downloadQueue.length) {
    let asset = downloadQueue[downloadIndex];
    downloadAsset(asset.url, asset.localPaths);

  } else {
    onAllAssetsComplete();
  }

}
function downloadAsset(url, localPaths) {

  request.head(url, (err, res) => {
    if (err) {
      onAssetError(err);
    } else {

      let readStream   = request(url, { maxSockets: 1 }),
          writeStream  = fileQueue.createWriteStream(`${__dirname}/${localPaths[0]}`).on('error', onAssetError);

      let readProgress = progress(readStream, {
        throttle: 100
      });

      let progressPrefix = `  ${rightAlignNum(downloadIndex + 1, downloadQueue.length)}/${downloadQueue.length}`;

      readProgress.on('error', onAssetError);

      readProgress.on('progress', (state) => {
        let suffix = formatFileSize(state.size.total);
        outputDownloadProgress(progressPrefix, state.percent, suffix);
      });

      readProgress.on('end', () => {
        if (localPaths.length > 1) {
          copyAssetToPaths(localPaths[0], localPaths.slice(1));
        }
        outputDownloadProgress(progressPrefix, 1);
        onAssetComplete();
      });

      readProgress.pipe(writeStream);

    }
  });

}

function copyAssetToPaths(source, targets) {

  targets.forEach((target) => {
    fs.writeFileSync(`${__dirname}/${target}`, fs.readFileSync(`${__dirname}/${source}`));
  })

}

function outputDownloadProgress(prefix, perc, suffix = ``) {

  const BAR_MAX_LEN = 25;

  const len = Math.ceil(BAR_MAX_LEN * perc),
        bar = `▇`.repeat(len),
        space = `━`.repeat(BAR_MAX_LEN - len).gray

  readline.clearLine(process.stdout);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(`${prefix}`.gray + ` ${bar}${space} ${suffix}`);

}

function outputMsgBox(msg) {

  let len   = msg.length,
      hLine = ``;

  for (var i = 0; i < (len + 2); i++) {
    hLine += `─`;
  }

  output(`┌${hLine}┐`.cyan);
  output(`│ `.cyan + msg + ` │`.cyan);
  output(`└${hLine}┘`.cyan);
  output(``);

}

function moveCompletedDownloads() {

  config.schemas.forEach((schema, schemaIndex) => {

    output(`\n  Moving schema ${schemaIndex + 1} files`);

    let schemaFromPath = `${__dirname}/${tempFolder}/${schemaIndex}`,
        schemaToPath   = schema.targetPath,
        hasAssets      = (!jsonOnly && schema.assets && schema.assets.length) ? true : false;

    // ~ converts to home directory
    if (schemaToPath.slice(0, 1) === '~') {
      schemaToPath = `${os.homedir()}${schemaToPath.slice(1)}`;
    }

    // remove trailing slash
    if (schemaToPath.slice(-1) === '/') {
      schemaToPath = schemaToPath.slice(0, -1);
    }

    schema.sources.forEach((source, sourceIndex) => {

      let sourceFolder    = source.targetFolder ? `/${source.targetFolder}` : ``,
          sourceFromPath  = schemaFromPath + sourceFolder,
          sourceToPath    = schemaToPath + sourceFolder;

      if (hasAssets) {

        let assetsFromPath = `${sourceFromPath}/assets`,
            assetsToPath   = `${sourceToPath}/assets`;

        output(`    ${assetsToPath}/ `.gray, true);
        moveFolder(assetsFromPath, assetsToPath);
        output(`✓`.green);

      }

      output(`    ${sourceToPath}/${source.targetFilename} `.gray, true);
      moveFile(sourceFromPath, sourceToPath, source.targetFilename);
      output(`✓`.green);

    });

  });

  onAllAssetsMoved();

}


// Helpers

function loadJSON(url) {

  var req = new xhr.XMLHttpRequest();

  if (req) {
    req.open('GET', url, false);
    req.send(null);
    return req.responseText;
  }

  return null;

}

function stringifyJSON(json, emitUnicode) {
  var result = JSON.stringify(json);
  return emitUnicode ? result : result.replace(/[\u007f-\uffff]/g,
    function(c) {
      return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
    }
  );
}

function output(msg, partialLine) {
  if (partialLine) {
    process.stdout.write(msg);
  } else {
    console.log(msg);
  }

}

function getFileExtension(file) {

  var extension = file.split('.').pop();

  if (extension.indexOf('?') != -1) {
    return extension.split('?')[0];

  } else if (extension.indexOf('&') != -1) {
    return extension.split('&')[0];
  }

  return extension;

}

function formatFileSize(bytes) {

  const KB = 1024,
        MB = 1024 * 1024;

  if (bytes < MB) {
    return `${Math.ceil(bytes / KB)} KB`;
  } else {
    return `${Math.ceil(bytes / MB)} MB`;
  }

}

function rightAlignNum(num, maxNum) {

  const curLen = num.toString().length,
        maxLen = maxNum.toString().length;

  return ` `.repeat(maxLen - curLen) + num;

}

function moveFolder(oldPath, newPath) {

  mkdirp.sync(newPath);
  rimraf.sync(newPath);
  fs.renameSync(oldPath, newPath);

}

function moveFile(fromFolder, toFolder, filename) {

  let fromPath = `${fromFolder}/${filename}`,
      toPath   = `${toFolder}/${filename}`;

  mkdirp.sync(toFolder);
  rimraf.sync(toPath);
  fs.renameSync(fromPath, toPath);

}
