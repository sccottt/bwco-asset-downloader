
// Requires

const colors   = require('colors'),
      fetch    = require('node-fetch'),
      fq       = require('filequeue'),
      fs       = require('fs'),
      os       = require('os'),
      mkdirp   = require('mkdirp'),
      request  = require('request'),
      rp       = require('request-promise-native'),
      rimraf   = require('rimraf'),
      progress = require('request-progress'),
      readline = require('readline'),
      argv     = require('minimist')(process.argv.slice(2));

const pkg      = require('./package.json'),
      config   = require(`./` + (argv.config ? argv.config : `config.json`));


// Constants

const TEMP_DL_FOLDER = 'temp',
      DL_BAR_LENGTH  = 25;

// Vars

var downloads = [];


// Init

init();

function init() {

  initWelcome();
  initFolders();

  loadSources();

}
function initWelcome() {

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

}
function initFolders() {

  tempFolder = `${TEMP_DL_FOLDER}/${Date.now()}`;
  mkdirp.sync(tempFolder);

}


// Functions

function loadSources() {

  outputMsgBox(`Downloading...`);

  //config.schemas[].sources[].url

  Promise.all(config.schemas.map((schema, schemaIndex) =>
    Promise.all(schema.sources.map((source, sourceIndex) =>
      fetch(source.url)
        .then((result) => result.json())
        .then((sourceData) => {
          return Promise.all(schema.assets.reduce((objs, fieldPath) => objs.concat(getDownloadObjs(sourceData, fieldPath)), []))
            .then((downloadObjs) => processDownloadObjs(downloadObjs))
            .then((result) => {
              console.log(`\n\n`);
              console.log(result);
              console.log(`\n\n`);
              console.log(sourceData);
            })
        })
    ))
  )).catch((error) => {
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
