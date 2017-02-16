'use strict'

const config = require('./config')

const Bot = require('./Bot')

const bot = new Bot(config.team)

bot.client.start()

