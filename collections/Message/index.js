'use strict'

module.exports = (mongoose) => {
    const Message = mongoose.model('Message', {
        type: String,
        channel: String,
        user: String,
        text: String,
        ts: Date,
        team: String 
    })

    return Message
}
