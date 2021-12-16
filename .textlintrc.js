module.exports = {
  plugins: {
    "@textlint/markdown": {
      "extensions": [".md"]
    }
  },
  rules: {
    "preset-ja-spacing": {
      "ja-space-between-half-and-full-width": {
        space: "always",
        exceptPunctuation: true,
      },
      "ja-space-around-code": {
        "before": true,
        "after": true
      }
    },

    // https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing
    "preset-ja-technical-writing": {
      // https://github.com/textlint-ja/textlint-rule-ja-no-mixed-period
      "ja-no-mixed-period": {
        allowEmojiAtEnd: true,   // 句点としてEmojiを許可
        allowPeriodMarks: [":"], // 句点として":"を許可
      },

      "no-exclamation-question-mark": false,
      "sentence-length": 120,
    },
  }
};
