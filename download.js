
// Requires

const colors   = require('colors'),
      fetch    = require('node-fetch'),
      fq       = require('filequeue'),
      fse      = require('fs-extra'),
      os       = require('os'),
      rp       = require('request-promise-native'),
      progress = require('request-progress'),
      readline = require('readline'),
      argv     = require('minimist')(process.argv.slice(2));

const pkg      = require('./package.json'),
      config   = require(`./` + (argv.config ? argv.config : `config.json`));


// Constants

const DL_BAR_LENGTH  = 25;


// Vars

var downloads  = [],
    tempFolder = `temp/${Date.now()}`;


// Init

init();

function init() {

  output();
  outputMsgBox(`BWCo Asset Downloader v${pkg.version}`)

  output(`Downloading assets for ${config.schemas.length} JSON schema(s):`);
  config.schemas.forEach((schema, i) => {
    output(`\n  Schema ${i + 1}:`);
    schema.sources.forEach((source, j) => {
      output(`    ${source.url}`.gray);
    })
  });
  output();

  loadSources();

}


// Functions

function loadSources() {

  outputMsgBox(`Downloading...`);

  Promise.all(config.schemas.map((schema, schemaIndex) =>
    Promise.all(schema.sources.map((source, sourceIndex) =>
      fetch(source.url)
        .then((result) => result.json())
        .then((sourceData) => {

          let pathSchema = `${tempFolder}/${schemaIndex}`,
              pathSource = pathSchema + (source.targetFolder ? `/${source.targetFolder}` : ``),
              pathAssets = pathSource + (schema.assets && schema.assets.length ? `/assets` : ``),
              pathJSON   = `${pathSource}/${source.targetFilename}`,
              pathOutput = config.targetFolder + (source.targetFolder ? `/${source.targetFolder}` : ``) + `/assets`;

          return Promise.all(schema.assets.reduce((objs, fieldPath) => objs.concat(getDownloadObjs(sourceData, fieldPath)), []))
            .then((downloadObjs) => processDownloadObjs(downloadObjs))
            .then(() => fse.outputJson(pathJSON, sourceData))

        })
    ))
  )).then((result) => {
    console.log(`Complete!`);

  }).catch((error) => {
    output(`  ERROR: ${error}`.red);
    console.log(error);
  });

}

function getDownloadObjs(data, fieldPath) {

  const objs            = [];
  const addDownloadObjs = (node, fields, filename) => {

    let field      = fields[0],
        fieldsLeft = fields.slice(1);

    filename      += field;

    if (fieldsLeft.length) {
      if (node[field]) {
        if (Array.isArray(node[field])) {
          for (let i = 0; i < node[field].length; i++) {
            addDownloadObjs(node[field][i], fieldsLeft, `${filename}-${i + 1}-`);
          }
        } else {
          addDownloadObjs(node[field], fieldsLeft, `${filename}-`);
        }
      }
    } else {
      objs.push({ node, field, filename });
    }

  }

  addDownloadObjs(data, fieldPath.split('.'), '');

  return objs;

}

function processDownloadObjs(objs) {

  let downloads = [];

  return Promise.all(objs.map((obj, objIndex) => {

    let url       = obj.node[obj.field];

    return rp({
      uri: url,
      resolveWithFullResponse: true
    }).then((res) => {

      let resolvedUrl     = res.request.uri.href,
          localPath       = `file://Users/scott/Desktop/${obj.filename}.${getFileExtension(resolvedUrl)}`;

      // Update path on object reference itself (to localPath),
      // for when the object is written to JSON
      obj.node[obj.field] = localPath;

      let toDownload = {
        localPath: localPath,
        url: resolvedUrl
      };

      let lastDownload = downloads.find((download) => (download.url === toDownload.url));

      downloads.push(toDownload);

      if (lastDownload) {
        return copyAsset(lastDownload.localPath, toDownload.localPath);
      } else {
        return downloadAsset(toDownload);
      }

    })

  }));

}
function downloadAsset(download) {

  console.log('Downloading asset');
  console.log(`  from: ${download.url}`);
  console.log(`  to:   ${download.localPath}`);

  return new Promise((resolve, reject) => resolve(`Downloaded to ${download.localPath}`));

}
function copyAsset(fromPath, toPath) {

  console.log('Copying asset');
  console.log(`  from: ${fromPath}`);
  console.log(`  to:   ${toPath}`);

  return new Promise((resolve, reject) => resolve(`Copied to ${toPath}`));

}


// Helpers

function output(msg, partialLine) {
  if (partialLine) {
    process.stdout.write(msg || ``);
  } else {
    console.log(msg || ``);
  }

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
  output();

}

function getFileExtension(file) {
  return file.split('.').pop().split('?').shift();
}

function stringifyJSON(json, emitUnicode) {
  var result = JSON.stringify(json);
  return emitUnicode ? result : result.replace(/[\u007f-\uffff]/g,
    function(c) {
      return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
    }
  );
}
