const { terms } = require('../gameConfig/SolarTerms.json');

function parseSolarTime(value) {
    if (typeof value !== 'string') return 0;
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match) return 0;
    return Date.parse(`${match[1]}T${match[2].padStart(2, '0')}:${match[3]}:${match[4]}+08:00`) / 1000 || 0;
}

const solarTermsConfig = new Map(terms.map(term => {
    const options = String(term.answer || '').split(';').map(value => value.trim()).filter(Boolean);
    return [term.id, {
        ...term,
        options,
        correctOptionIndex: Number.isInteger(term.answer_index) && term.answer_index >= 0 && term.answer_index < options.length
            ? term.answer_index : null,
        startTime: parseSolarTime(term.open_start),
        endTime: parseSolarTime(term.open_end),
    }];
}));

function hasSolarQuiz(config) {
    return !!config?.question && config.options.length === 4 && config.correctOptionIndex !== null;
}

function isSolarQuizActive(nowSeconds = Math.floor(Date.now() / 1000)) {
    return [...solarTermsConfig.values()].some(config => hasSolarQuiz(config)
        && config.startTime > 0 && config.endTime >= config.startTime
        && nowSeconds >= config.startTime && nowSeconds <= config.endTime);
}

module.exports = { solarTermsConfig, hasSolarQuiz, isSolarQuizActive, parseSolarTime };
