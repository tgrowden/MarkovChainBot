'use strict'

const MarkovChain = require('markov-chain-generator')
const mongoose = require('mongoose')
const RtmClient = require('@slack/client').RtmClient
const RTM_EVENTS = require('@slack/client').RTM_EVENTS
const CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS

/**
 * Markov Chain Slack Bot
 * 
 * @class Bot
 */
class Bot {
    /**
     * Creates an instance of Bot.
     * 
     * 
     * @memberOf Bot
     */
    constructor(config) {
        this.config = Object.assign({limit: 150}, config)
        if (!config.token) {
            throw new Error('The "Bot" class cannot be instantiated without a token')
        }
        if (!config.name) {
            throw new Error('The "Bot" class cannot be instantiated without a name')
        }
        if (!config.connection) {
            throw new Error('The "Bot" class cannot be instantiated without a connection')
        }
        this.logger = console
        this._db()
        
        this.events = {
            rtm: RTM_EVENTS,
            client: CLIENT_EVENTS
        }

        this.client = new RtmClient(this.config.token, {
            logLevel: 'error'
        })
        this.run()
    }

    /**
     * Handles setup of the database
     * 
     * @memberOf Bot
     */
    _db() {
        mongoose.Promise = global.Promise
        mongoose.connect(this.config.connection)

        let collections = {
            Message: require('../collections/Message')(mongoose)
        }

        this.collections = collections
        this.db = mongoose
    }

    /**
     * Sets up event bindings for the bot client
     * 
     * @memberOf Bot
     */
    run() {
        const self = this
        this.client.on(this.events.client.RTM.AUTHENTICATED, data => {
            self.name = data.self.name
            self.id = data.self.id
            self.logger.log(`${self.config.name} bot has connected`)
        })
        this.client.on(this.events.rtm.MESSAGE, msg => {
            let queryParams = self.getMsgTag(msg)
            if (queryParams) {
                self.generate(queryParams)
            } else if (queryParams === false && self.warrentsSave(msg)) {
                self.saveMessage(msg)
            }
        })
    }


    /**
     * Determines if a message warrents saving
     *
     * @todo look into message subtypes. as-is, this may not be sufficient
     * @param {Object} msg
     * @returns {Boolean} save the message
     * 
     * @memberOf Bot
     */
    warrentsSave(msg) {
        let res = true
        if (msg.subtype && msg.subtype == 'file_share') {
            res = false
        }

        return res
    }

    /**
     * Saves a message to the database
     * 
     * @param {Object} msg
     * 
     * @memberOf Bot
     */
    saveMessage(msg) {
        msg.ts = new Date(msg.ts * 1000)
        let message = new this.collections.Message(msg)
        message.save(err => {
            if (err) {
                throw new Error(err)
            }
        })
    }

    /**
     * Generates a Markov chain and posts it in reponse of a message
     * 
     * @param {Object} params
     * 
     * @memberOf Bot
     */
    generate(params) {
        const self = this
        this.collections.Message
            .find({
                user: params.user
            })
            .limit(params.limit)
            .then(messages => {
                if (!messages.length) {
                    self.deny(params.channel)
                    return false
                }
                var textArr = messages.map(msg => {
                    return msg.text
                })
                let chain = self.generateChain(textArr.join(' '))
                self.postChain(chain, params.user, params.channel)
            })
    }

    /**
     * Generates a Markov chain from a seed
     * 
     * @param {String} seed
     * @returns {String} the Markov chain
     * 
     * @memberOf Bot
     */
    generateChain(seed) {
        let chain = new MarkovChain(seed, null, this.config.limit)

        return chain.generate()
    }

    /**
     * Posts a Markov chain, refrencing a user, to a given channel
     * 
     * @param {String} chain the Markov chain
     * @param {String} user the user's ID
     * @param {String} channel the channel's ID
     * 
     * @memberOf Bot
     */
    postChain(chain, user, channel) {
        let msg = `<@${user}> says: ${chain}`
        this.client.sendMessage(msg, channel)
    }

    /**
     * Posts a string when a chain cannot be reasonably generated
     * 
     * @param {String} channel the channel ID
     * 
     * @memberOf Bot
     */
    deny(channel) {
        this.client.sendMessage('I\'m sorry, Dave. I\'m afraid I can\'t do that', channel)
    }

    /**
     * Determines if a message contains a tag (user ID) for which to generate a Markov chain
     * 
     * @param {Object} msg the message object
     * @returns {false|null|Object} Object when relevant, null when not possible, false when irrelevant
     * 
     * @memberOf Bot
     */
    getMsgTag(msg) {
        let msgArray = msg.text.split(' ')
        let res = false

        if (msgArray[0] == `<@${this.id}>` && msgArray[1]) {
            if (msgArray[1] == 'me') {
                res = {
                    user: msg.user,
                    channel: msg.channel,
                    limit: parseInt(msgArray[2]) || this.config.limit
                }
            } else if (msgArray[1].indexOf('<@') == 0) {
                if (msgArray[1] == `<@${this.id}>`) {
                    res = null
                    this.deny(msg.channel)
                } else {
                    res = {
                        user: msgArray[1].replace(/[^0-9a-z]/gi, ''),
                        channel: msg.channel,
                        limit: parseInt(msgArray[2]) || this.config.limit
                    }
                }
            }
        }

        return res
    }
}

module.exports = Bot
