# Belle &amp; Wissell, Co. Asset Downloader

Command-line Node app that creates local copies of JSON data sources and their image/video/etc asset files.

## Process

The downloader:

- Reads from any number of JSON API endpoints
- Compiles a list of asset URLs, based on specified JSON nodes
- Downloads assets to a temporary folder on the local machine, naming the files to match the JSON schema
- Rewrites the paths of the assets in the JSON file(s) to match the local path, and saves the JSON file(s) locally
- Moves fully downloaded JSON and asset files to a specified location on the local machine, overwriting any existing JSON & assets
- Clears the temporary downloads folder


## Quick start

Clone and run the `sccottt/bwco-asset-downloader` repo to get started:

```bash
$ git clone https://github.com/sccottt/bwco-asset-downloader
$ cd bwco-asset-downloader
$ npm install
$ npm start -- --config config.example.json
```

## Usage

1. [Configure](#configuration) the downloader in the `config.json` file
1. Run the downloader:
```bash
$ npm run start
```


### Custom config file
By default, the app will read its config values from `config.json`. To use a different config file, use the `--config` argument, like so:

```bash
$ npm start -- --config config.custom.json
```

_Note_: The file must be sitting in the project folder.

### JSON only
To skip all asset downloads and only download the JSON files, use the `-j` (or `--json_only`) argument, like so:

```bash
$ npm start -- -j
$ npm start -- --json_only
```

_Note_: This can be used safely to update JSON files without affecting existing `assets` folders.

### Temp folder
If the downloader fails at any point, the `temp` folder will contain whatever data and assets were downloaded before the failure. This folder can be cleared out by running:

```bash
$ npm run clean
```

## Configuration

Configuration is made in the `config.json` file. An example [`config.example.json`](config.example.json) file is provided to demonstrate usage.

### `projectPath`
Full local path to the base directory of the relevant project. Rewritten asset paths in the JSON will be relative to this path. You may start the path with `~` to specify the home directory.

_**Note**: this directory will **not** be overwritten_.

### `targetFolder`
Name of the folder within the project directory where all downloaded data should be stored. Typically, this is set to `assets`.

_**Note**: this directory will **not** be overwritten_.

### `schemas`
An array of `schema` objects, each representing a single JSON data format/structure.

A `schema` may specify multiple [`sources`](#sources), so long as the JSON of each [`source`](#sources) follows the same data format/structure.

- `sources`: Array of [`sources`](#sources)
- `assets`: (optional) Array of [`assets`](#assets)
    - If omitted, only the JSON for this source will be downloaded

### `sources`
An array of `source` objects, each representing a single JSON API endpoint to read from.

- `url`: Full URL to the JSON endpoint
- `targetFolder`: Folder name (inside the inside the `schema`'s `targetPath`) where the data & assets for this `source` will be stored. _**Warning**: if a folder of the same name already exists here, its contents **will** be overwritten_.
- `targetFilename`: Filename of the downloaded JSON data file

### `assets`
An array of strings, each representing a node (or set of nodes) within the JSON where an asset URL is specified.

Each string is formatted to dig down one node at a time through the JSON to reach a final node with a URL. Node names are separated by `.` (periods) and can represent objects, arrays, or (if at the URL node itself) a text node.

e.g., the following `assets` array will capture all of the image and video URLs in the JSON below.

```json
"assets": [
  "settings.background.img",
  "stories.img",
  "stories.vid",
  "otherImgs"
]
```

```json
{
  "settings": {
    "background": {
      "enabled": true,
      "img": "http://example.com/bg-image.png",
      "opacity": 0.75
    }
  },
  "stories": [
    {
      "title": "First story",
      "img": "http://example.com/image-1.jpg"
    },
    {
      "title": "Second story",
      "img": "http://example.com/image-2.jpg",
      "vid": "http://example.com/vid-2.mp4"
    }
  ],
  "otherImgs": [
    "http://example.com/other-1.jpg",
    "http://example.com/other-2.jpg",
    "http://example.com/other-3.jpg",
  ]

}
```
