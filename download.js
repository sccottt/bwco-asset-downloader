
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

const TEMP_DL_FOLDER = "temp",
      DL_BAR_LENGTH  = 25;


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

  output(`\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510`.green);
  output(`\u2502 `.green + `BWCo Asset Downloader` + ` \u2502`.green + ` v${pkg.version}`);
  output(`\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518`.green);

  output(``);

  output(`  Downloading assets for ${config.schemas.length} JSON schema(s)`);
  config.schemas.forEach((schema, i) => {
    output(`\n    Schema ${i + 1} sources`);
    schema.sources.forEach((source, j) => {
      output(`      ${source.url}`.gray);
    })
  });

}
function initFolders() {

  output(`  Setting up folders`);

  output(`    Creating temporary downloads folder "${TEMP_DL_FOLDER}/${Date.now()}/"... `.gray, true)
  tempFolder = `${TEMP_DL_FOLDER}/${Date.now()}`;
  mkdirp.sync(tempFolder);
  output(`\u2713`.green);

}


// Event handlers

function onSchemaComplete() {

  schemaIndex++;
  processNextSchema();

}
function onAllSchemasComplete() {

  downloadAssets();

}

function onSourceComplete() {

  sourceIndex++;
  processNextSource();

}
function onAllSourcesComplete() {

  onSchemaComplete();

}

function onAssetComplete() {

  downloadIndex++;
  downloadNextAsset();

}
function onAllAssetsComplete() {

  output(`\n`);

  moveCompletedDownloads();

}
function onAssetError(err) {

  output(`Error loading asset: ${err}`.red);

}

function onAllAssetsMoved() {

  output(`  Clearing temporary downloads folder... `.gray, true);
  rimraf.sync(TEMP_DL_FOLDER);
  output(`\u2713`.green);

  output(``);
  output(`\u250C\u2500\u2500\u2500\u2510`.green);
  output(`\u2502 `.green + `\u2713` + ` \u2502`.green + ` All assets downloaded. Great job!`);
  output(`\u2514\u2500\u2500\u2500\u2518`.green);
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
    processSource(schema.sources[sourceIndex], schema.assets);
  } else {
    onAllSourcesComplete();
  }

}
function processSource(source, assets) {

  output(`  Processing schema ${schemaIndex + 1}, source ${sourceIndex + 1}:`);
  output(`    ${source.url} `.gray, true);

  let schemaFolder = `${tempFolder}/${schemaIndex}`,
      sourceFolder = schemaFolder + (source.targetFolder ? `/${source.targetFolder}` : ``),
      assetsFolder = sourceFolder + (assets && assets.length ? `/assets` : ``),
      outputFolder = config.targetFolder + (source.targetFolder ? `/${source.targetFolder}` : ``) + `/assets`;

  mkdirp.sync(assetsFolder);

  let data = JSON.parse(loadJSON(source.url));

  if (assets && assets.length) {
    assets.forEach((assetField, j) => {
      processAssetField(assetField.split('.'), data, sourceFolder, outputFolder, ``);
    });
  }
  fs.writeFileSync(`${sourceFolder}/${source.targetFilename}`, stringifyJSON(data));

  output(`\u2713`.green);
  output(``);

  onSourceComplete();

}

function processAssetField(fields, obj, basePath, outputPath, filenameParts) {

  let field           = fields[0],
      fieldsRemaining = fields.slice(1);

  filenameParts += field;

  if (!fieldsRemaining.length) {
    if (obj[field]) {

      if (Array.isArray(obj[field])) {
        for (var i = 0; i < obj[field].length; i++) {

          let url       = obj[field][i],
              filename  = `${filenameParts}-${i}.${getFileExtension(url)}`,
              fullPath  = `${basePath}/assets/${filename}`;

          if (!jsonOnly) {
            addToDownloadQueue(url, fullPath);
          }

          obj[field][i] = `${outputPath}/${filename}`;

        }
      } else {

        let url       = obj[field],
            filename  = `${filenameParts}.${getFileExtension(url)}`,
            fullPath  = `${basePath}/assets/${filename}`;

        if (!jsonOnly) {
          addToDownloadQueue(url, fullPath);
        }

        obj[field]    = `${outputPath}/${filename}`;

      }

    }

  } else if (obj[field]) {

    if (Array.isArray(obj[field])) {
      for (var i = 0; i < obj[field].length; i++) {
        processAssetField(fieldsRemaining, obj[field][i], basePath, outputPath, `${filenameParts}-${i}-`);
      }

    } else {
      processAssetField(fieldsRemaining, obj[field], basePath, outputPath, `${filenameParts}-`);
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

  const progressPrefix = `  ${rightAlignNum(downloadIndex + 1, downloadQueue.length)}/${downloadQueue.length}`,
        percTotal      = (downloadIndex + 1) / downloadQueue.length;

  const readStream  = request(url, { maxSockets: 1 }),
        writeStream = fileQueue.createWriteStream(`${__dirname}/${localPaths[0]}`).on('error', onAssetError);

  let fileSize = 0,
      speed    = 0;

  const readProgress = progress(readStream, {
    throttle: 100
  })
  .on('error', onAssetError)
  .on('progress', (state) => {

    fileSize = state.size.total;
    speed    = state.speed;

    let suffix = `${formatFileSize(fileSize)} (${formatFileSize(speed)}/s)`;

    outputDownloadProgress(progressPrefix, state.percent, percTotal, suffix);

  })
  .on('end', () => {
    if (localPaths.length > 1) {
      copyAssetToPaths(localPaths[0], localPaths.slice(1));
    }
    let suffix = `${formatFileSize(fileSize)} (${formatFileSize(speed)}/s)` + ` \u2713`.green;
    outputDownloadProgress(progressPrefix, 1, percTotal, suffix);
    onAssetComplete();
  })
  .pipe(writeStream);

}

function copyAssetToPaths(source, targets) {

  targets.forEach((target) => {

    let pathSrc  = `${__dirname}/${source}`,
        pathTrgt = `${__dirname}/${target}`;

    fs.createReadStream(pathSrc).pipe(fs.createWriteStream(pathTrgt));

  })

}

function outputDownloadProgress(prefix, percFile, percTotal, suffix = ``) {

  const lenFile  = Math.ceil(DL_BAR_LENGTH * percFile),
        lenTotal = Math.max(0, Math.ceil(DL_BAR_LENGTH * percTotal) - lenFile),
        lenEmpty = DL_BAR_LENGTH - lenFile - lenTotal;

  const barFile  = (lenFile  > 0) ? `\u2588`.repeat(lenFile) : ``,
        barTotal = (lenTotal > 0) ? `\u2591`.repeat(lenTotal).green : ``,
        barEmpty = (lenEmpty > 0) ? `\u2501`.repeat(lenEmpty).gray : ``;

  readline.clearLine(process.stdout);
  readline.cursorTo(process.stdout, 0);

  process.stdout.write(`${prefix}`.gray + ` ${barFile}${barTotal}${barEmpty} ${suffix} `);

}

function outputMsgBox(msg) {

  let len   = msg.length,
      hLine = ``;

  for (var i = 0; i < (len + 2); i++) {
    hLine += `\u2500`;
  }

  output(`\u250C${hLine}\u2510`.cyan);
  output(`\u2502 `.cyan + msg + ` \u2502`.cyan);
  output(`\u2514${hLine}\u2518`.cyan);
  output(``);

}

function moveCompletedDownloads() {

  outputMsgBox(`Moving files`)

  config.schemas.forEach((schema, schemaIndex) => {

    output(`  Moving schema ${schemaIndex + 1} files`);

    let schemaFromPath = `${__dirname}/${tempFolder}/${schemaIndex}`,
        schemaToPath   = `${config.projectPath}/${config.targetFolder}`,
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
        output(`\u2713`.green);

      }

      output(`    ${sourceToPath}/${source.targetFilename} `.gray, true);
      moveFile(sourceFromPath, sourceToPath, source.targetFilename);
      output(`\u2713`.green);

    });

    output(``);

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
