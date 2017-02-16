module.exports = {
    "env": {
        "node": true,
        "es6": true
    },
    "extends": "eslint:recommended",
    "globals": {
        "$": true
    },
    "rules": {
        "indent": [
            "error",
            4
        ],
        "linebreak-style": [
            "error",
            "unix"
        ],
        "quotes": [
            "warn",
            "single"
        ],
        "semi": [
            "error",
            "never"
        ]
    }
};
