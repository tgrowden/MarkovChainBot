'use strict'

const config = require('./config')

const Bot = require('./Bot')

config.teams.forEach(teamConfig => {
    let bot = new Bot(teamConfig)
    bot.client.start()
})
