
// Requires

const colors   = require('colors'),
      fetch    = require('node-fetch'),
      fs       = require('fs'),
      fse      = require('fs-extra'),
      logBox   = require('log-box'),
      os       = require('os'),
      request  = require('request'),
      rp       = require('request-promise-native'),
      progress = require('request-progress'),
      readline = require('readline'),
      argv     = require('minimist')(process.argv.slice(2));

const pkg        = require('./package.json'),
      configFile = `./` + (argv.config ? argv.config : `config.json`),
      config     = require(configFile);


// Constants

const DL_BAR_LENGTH  = 40;


// Vars

var tempFolder = `temp/${Date.now()}`,
    jsonOnly   = argv.j || argv.json_only;


// Init

start();


// Functions

function start() {

  logBox(`BWCo Asset Downloader v${pkg.version}`, {
    margin: {
      top: 2
    }
  });

  logSetup();

  logBox(`Processing sources`);

  let downloadQueue = [];

  Promise.all(config.schemas.map((schema, schemaIndex) =>
    Promise.all(schema.sources.map((source, sourceIndex) =>
      fetch(source.url)
        .then((result) => result.json())
        .then((sourceData) => {

          let sourceFolder       = source.targetFolder ? `/${source.targetFolder}` : ``;
              downloadPath       = `${tempFolder}/${schemaIndex}${sourceFolder}`,
              downloadPathAssets = `${downloadPath}/assets`,
              inJsonPathAssets   = `${config.targetFolder}${sourceFolder}/assets`;

          let assetObjs          = createAssetObjs(schema.assets, sourceData),
              assetCount         = jsonOnly ? 0 : assetObjs.length;

          logMsgSourceProcessed(schemaIndex, sourceIndex, source.url, assetCount);

          return createDownloadObjs(assetObjs, downloadPathAssets, inJsonPathAssets)
            .then((objs) => {

              let sourceFolder       = source.targetFolder ? `/${source.targetFolder}` : ``;
                  downloadPathJson   = `${tempFolder}/${schemaIndex}${sourceFolder}/${source.targetFilename}`;

              if (!jsonOnly) {
                downloadQueue = downloadQueue.concat(objs);
              }

              return fse.outputFile(downloadPathJson, stringifyJSON(sourceData));
            })
            .catch((error) => console.log(error));

        })
    ))
  ))
  .then(() => {
    logMsgSourcesProcessed(downloadQueue.length);
    startDownloadQueue(downloadQueue);
  })
  .catch((error) => console.log(error));

}

function createAssetObjs(fieldPaths, data) {

  const objs = [];

  const addAssetObjs = (node, fields, filename) => {

    let field      = fields[0],
        fieldsLeft = fields.slice(1);

    filename      += field;

    if (fieldsLeft.length) {
      if (node[field]) {
        if (Array.isArray(node[field])) {
          for (let i = 0; i < node[field].length; i++) {
            addAssetObjs(node[field][i], fieldsLeft, `${filename}-${i + 1}-`);
          }
        } else {
          addAssetObjs(node[field], fieldsLeft, `${filename}-`);
        }
      }
    } else {
      objs.push({ node, field, filename });
    }

  }

  if (fieldPaths && fieldPaths.length) {
    fieldPaths.forEach((fieldPath) => {
      addAssetObjs(data, fieldPath.split('.'), '');
    })
  }

  return objs;

}

function createDownloadObjs(assetObjs, folderDownload, folderInJson) {

  let downloads = [];

  const queueDownload = (from, to) => {
    let queued = downloads.find((download) => (download.from === from));
    if (!!queued) {
      queued.to.push(to);
    } else {
      downloads.push({
        from: from,
        to: [ to ]
      });
    }
  }

  return Promise.all(assetObjs.map((assetObj, objIndex) => {

    let url       = assetObj.node[assetObj.field];

    return rp({
      uri: url,
      method: 'HEAD',
      resolveWithFullResponse: true
    })
    .then((response) => new Promise((resolve, reject) => {

      let urlResolved  = response.request.uri.href,
          filename     = `${assetObj.filename}.${getFileExtension(urlResolved)}`,
          pathDownload = `${folderDownload}/${filename}`,
          pathInJson   = `${folderInJson}/${filename}`;

      // Update path on object reference itself (to pathInJson),
      // for when the object is written to JSON locally
      assetObj.node[assetObj.field] = pathInJson;

      queueDownload(urlResolved, pathDownload);

      resolve();

    }))
    .catch((error) => console.log(error));

  }))
  .then(() => new Promise((resolve, reject) => {
    resolve(downloads);
  }));

}

function startDownloadQueue(queue) {

  logBox("Downloading assets");

  let downloadIndex = 0;

  const onAssetError = (error) => {
    logMsg(`${error}`.red);
    console.log(error);
  }

  const downloadNext = () => {

    const download     = queue[downloadIndex],
          outputPath   = `${__dirname}/${download.to[0]}`;

    fse.ensureFileSync(outputPath);

    const readStream   = request(download.from),
          writeStream  = fs.createWriteStream(outputPath).on('error', onAssetError);

    let fileSize       = 0;

    const readProgress = progress(readStream, {
      throttle: 100
    })
    .on('error', onAssetError)
    .on('progress', (state) => {
      fileSize = state.size.total;
      logMsgProgress(downloadIndex, queue.length, fileSize, state.percent, state.speed)
    })
    .on('end', () => {

      if (download.to.length > 1) {
        copyAssetToPaths(download.to[0], download.to.slice(1));
      }

      logMsgProgress(downloadIndex, queue.length, fileSize, 1)

      if (++downloadIndex < queue.length) {
        downloadNext();
      } else {
        logMsg(`\n`);
        logMsg(`  ${queue.length}`.cyan + ` assets downloaded`);
        logMsg();

        moveCompletedFiles();

      }

    })
    .pipe(writeStream);

  }

  if (!queue.length) {
    logMsg(`  No assets to download`);
    logMsg();
    moveCompletedFiles();

  } else {
    downloadNext();
  }

}

function copyAssetToPaths(source, targets) {

  targets.forEach((target) => {

    let pathSrc  = `${__dirname}/${source}`,
        pathTrgt = `${__dirname}/${target}`;

    fse.ensureFileSync(pathTrgt);
    fs.createReadStream(pathSrc).pipe(fs.createWriteStream(pathTrgt));

  })

}

function moveCompletedFiles() {

  logBox(`Moving files to project folder`)

  config.schemas.forEach((schema, schemaIndex) => {

    logMsg(`  Moving schema ${schemaIndex + 1} files`);

    let schemaFromPath = `${__dirname}/${tempFolder}/${schemaIndex}`,
        schemaToPath   = `${config.projectPath}/${config.targetFolder}`,
        hasAssets      = !jsonOnly && !!schema.assets && !!schema.assets.length;

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

        logMsg(`    ${assetsToPath}`.gray);

        fse.moveSync(assetsFromPath, assetsToPath, {
          overwrite: true
        })

      }

      logMsg(`    ${sourceToPath}/${source.targetFilename}`.gray);

      fse.moveSync(`${sourceFromPath}/${source.targetFilename}`, `${sourceToPath}/${source.targetFilename}`, {
        overwrite: true
      });

    });

    logMsg();

  });

  logBox(`All assets ready! Great job`)

}


// Output

function logSetup() {

  if (jsonOnly) {
    logMsg(`  WARNING: `.red + `JSON only mode enabled (skipping asset download)\n`);
  }

  logMsg(`  Config: ${configFile}`);

  config.schemas.forEach((schema, i) => {
    logMsg(`\n  Schema ${i + 1}`);
    schema.sources.forEach((source, j) => {
      logMsg(`    ${source.url}`.gray);
    })
  });
  logMsg();

}
function logMsgSourceProcessed(schemaIndex, sourceIndex, sourceUrl, count) {
  logMsg(`  Schema ${schemaIndex + 1}, source ${sourceIndex + 1} processed`)
  logMsg(`    ${sourceUrl}`.gray);
  if (count > 0) {
    logMsg(`    ${count}`.cyan + ` downloads queued`.gray);
  } else {
    logMsg(`    No assets to download`.gray);
  }
  logMsg();
}
function logMsgSourcesProcessed(count) {
  logMsg(`  All sources processed`);
  logMsg(`    ${count}`.cyan + ` downloads queued`.gray)
  logMsg();
}
function logMsgProgress(index, count, size, perc, speed = 0) {

  const percTotal = (index + 1) / count,
        prefix    = `${rightAlignNum(index + 1, count)}/${count}`,
        suffix    = `${formatFileSize(size)}` + ((speed > 0) ? ` (${formatFileSize(speed)}/s)` : ``)

  const lenFile  = Math.ceil(DL_BAR_LENGTH * perc),
        lenTotal = Math.ceil(DL_BAR_LENGTH * percTotal);

  const lenFT    = Math.min(lenFile, lenTotal),
        lenF     = lenFile  - lenFT,
        lenT     = lenTotal - lenFT,
        lenEmpty = DL_BAR_LENGTH - (lenFT + lenF + lenT);

  const barFT    = (lenFT    > 0) ? `\u2588`.repeat(lenFT).cyan : ``,
        barF     = (lenF     > 0) ? `\u2580`.repeat(lenF).white : ``,
        barT     = (lenT     > 0) ? `\u2584`.repeat(lenT).cyan : ``,
        barEmpty = (lenEmpty > 0) ? `\u2501`.repeat(lenEmpty).gray : ``,
        bar      = barFT + barF + barT + barEmpty;

  readline.clearLine(process.stdout);
  readline.cursorTo(process.stdout, 0);

  process.stdout.write(`  ${prefix}`.gray + ` ${bar} ${suffix} `);

}


// Helpers

function logMsg(msg, partialLine) {
  if (partialLine) {
    process.stdout.write(msg || ``);
  } else {
    console.log(msg || ``);
  }

}

function getFileExtension(file) {
  return file.split('.').pop().split('?').shift();
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

function stringifyJSON(json, emitUnicode) {
  var result = JSON.stringify(json);
  return emitUnicode ? result : result.replace(/[\u007f-\uffff]/g,
    function(c) {
      return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
    }
  );
}
