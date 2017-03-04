'use strict'

const MarkovChain = require('markov-chain-generator')
const mongoose = require('mongoose')
const RtmClient = require('@slack/client').RtmClient
const RTM_EVENTS = require('@slack/client').RTM_EVENTS
const CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS
const defaultConfig = require('../config/default')

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
        this.config = Object.assign(defaultConfig, config)
        this._setCommands()
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
     * Set the _commands property, which maps a string to a method in the class
     * 
     * 
     * @memberOf Bot
     */
    _setCommands() {
        this._commands = {
            purge: {
                method: '_purge',
                description: 'Purges all of a user\'s messages from the database'
            },
            help: {
                method: '_help',
                description: 'Displays the help message'
            }
        }
    }

    /**
     * Executes a method based on the string passed
     * 
     * @param {String} methodName The name of the property in bot's _commands object
     * @param {any} args The arguments passed to the given method
     * 
     * @memberOf Bot
     */
    _exec(methodName, msg, args) {
        if (~args.indexOf('-h') || ~args.indexOf('--help')) {
            let prop = msg.text.split(' ')[1]
            let text = this._commands[prop].description
            this.client.sendMessage(text, msg.channel)
        } else {
            this[methodName](msg, args)
        }
    }

    /**
     * Displays description text for all commands
     * 
     * @param {Object} msg The message object
     * 
     * @memberOf Bot
     */
    _help(msg) {
        let text = ['Here is a list of the commands I know: \r']
        for (let name of Object.keys(this._commands)) {
            text.push(`\`${name}\`: ${this._commands[name].description}`)
        }
        this.client.sendMessage(text.join('\r'), msg.channel)
    }

    /**
     * Purges chat history records for a given user
     *
     * @param {Object} msg The message object
     * @param {Array} args The array of other arguments
     * 
     * @memberOf Bot
     */
    _purge(msg) {
        this.collections.Message.remove({user: msg.user}).exec()
            .then(() => {
                this.client.sendMessage(`<@${msg.user}> Your messages have been purged!`, msg.channel)
            })
    }

    /**
     * Parses message text for a command
     * 
     * @param {Object} msg The message Object
     * @returns {String|bool} The name of the method to execute, or false
     * 
     * @memberOf Bot
     */
    _parseCommand(msg) {
        let msgArr = this._isCalled(msg)
        if (msgArr && msgArr[0]) {
            msgArr.shift()
            let command = this._commands[msgArr[0]]
            if (command) {
                msgArr.shift()
                return {
                    method: command.method,
                    description: command.description,
                    args: msgArr
                }
            }
        }

        return false
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
            let command = this._parseCommand(msg)
            if (queryParams) {
                self.generate(queryParams)
            } else if (command) {
                this._exec(command.method, msg, command.args)
            } else if (queryParams === false && self._warrantsSave(msg)) {
                self.saveMessage(msg)
            }
        })
    }


    /**
     * Determines if a message warrants saving
     *
     * @todo look into message subtypes. as-is, this may not be sufficient
     * @param {Object} msg
     * @returns {Boolean} save the message
     * 
     * @memberOf Bot
     */
    _warrantsSave(msg) {
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
     * Generates a Markov chain and posts it in response of a message
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
     * Posts a Markov chain, referencing a user, to a given channel
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

        if (this._isCalled(msg)) {
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

    /**
     * Checks a message to see if the bot is being explicitly called via a tag
     * 
     * @param {Object|Array} msg The message object, or an array of the message text
     * @returns {Array|Boolean} The message array if the bot was called | false if it was not
     * 
     * @memberOf Bot
     */
    _isCalled(msg) {
        let msgArr
        if (msg instanceof Object) {
            msgArr = msg.text.split(' ')
        } else if (msg instanceof Array) {
            msgArr = msg
        }
        if (msgArr.length && msgArr[1] && msgArr[0] == `<@${this.id}>`) {
            return msgArr
        }

        return false
    }
}

module.exports = Bot
