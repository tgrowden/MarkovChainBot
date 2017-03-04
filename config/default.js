'use strict'

const fs = require('fs')
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'))

const defaultConfig = {
    limit: 150,
    package: {
        version: packageJson.version,
        repo: packageJson.homepage,
        bugs: packageJson.bugs.url,
        author: packageJson.author
    }
}

module.exports = defaultConfig
