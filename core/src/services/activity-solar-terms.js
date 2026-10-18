const { solarTermsConfig, hasSolarQuiz } = require('../config/solar-terms');

const SERVICE = 'gamepb.solartermspb.SolarTermsV2Service';

// One instance per account worker: manual and automatic answers share the lock.
function createSolarTermsService({ types, send, assertConnected, now, mapItem }) {
    let answering = false;

    function normalizeEvent(event, nowTime = now()) {
        if (!event || Number(event.id) <= 0) return null;
        const id = Number(event.id);
        const config = solarTermsConfig.get(id);
        const status = Number(event.window_status);
        const startTime = Number(event.open_start_time);
        const endTime = Number(event.open_end_time);
        const active = status === 2 && startTime > 0 && endTime >= startTime
            && nowTime >= startTime && nowTime <= endTime;
        const answerAvailable = hasSolarQuiz(config);
        const configActive = answerAvailable && config.startTime > 0 && config.endTime >= config.startTime
            && nowTime >= config.startTime && nowTime <= config.endTime;
        const wrongOptions = (event.wrong_options || []).map(Number);
        const answerable = !!(active && configActive && !event.quiz_claimed && !event.quiz_wrong_today);
        const answerStatus = event.quiz_claimed ? '答题奖励已领取'
            : event.quiz_wrong_today ? '今日答错，明日再试'
                : !active ? '当前不在答题时间内' : !configActive ? '本地题库未覆盖当前活动' : '可答题';
        return {
            id, status, startTime, endTime,
            statusLabel: status === 3 || (endTime > 0 && nowTime > endTime) ? '已结束'
                : status === 1 || (startTime > 0 && nowTime < startTime) ? '未开始'
                    : active ? '进行中' : '暂不可参与',
            claimable: active && !event.direct_claimed,
            title: config?.name || `节令${id}`,
            rewards: (event.rewards || []).map(mapItem),
            questionRewards: (event.question_rewards || []).map(mapItem),
            question: config?.question || '',
            options: config?.options || [],
            correctOptionIndex: config?.correctOptionIndex ?? null,
            explanation: config?.error_tips || '',
            directClaimed: !!event.direct_claimed,
            quizClaimed: !!event.quiz_claimed,
            quizWrongToday: !!event.quiz_wrong_today,
            wrongOptions, answerAvailable, answerable, answerStatus,
        };
    }

    function summarize(terms, nowTime, extra = {}) {
        const group = term => term.claimable || term.answerable ? 0
            : term.startTime <= nowTime && nowTime <= term.endTime ? 1 : term.startTime > nowTime ? 2 : 3;
        terms.sort((a, b) => group(a) - group(b)
            || (group(a) === 3 ? b.startTime - a.startTime : a.startTime - b.startTime));
        return {
            ...extra, version: 'v2', nowTime, terms,
            claimableCount: terms.filter(term => term.claimable).length,
            currentTerm: terms.find(term => term.startTime <= nowTime && nowTime <= term.endTime) || null,
            nextTerm: terms.find(term => term.startTime > nowTime) || null,
        };
    }

    async function getInfo() {
        assertConnected('节令查询');
        const { body } = await send(SERVICE, 'GetSolarTermsV2', types.GetSolarTermsV2Request.encode({}).finish());
        const reply = types.GetSolarTermsV2Reply.decode(body);
        const nowTime = Number(reply.server_time) || now();
        const terms = (reply.events || []).map(event => normalizeEvent(event, nowTime)).filter(Boolean);
        return summarize(terms, nowTime, { entryRedDot: !!reply.entry_red_dot, albumRedDot: !!reply.album_red_dot });
    }

    async function answer(termId, optionIndex, canProceed = () => true) {
        assertConnected('节令答题');
        if (!Number.isSafeInteger(termId) || termId <= 0 || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3)
            throw new Error('节令答题参数无效');
        if (answering) throw new Error('节令答题正在提交，请稍后刷新');
        answering = true;
        try {
            const before = await getInfo();
            const target = before.terms.find(term => term.id === termId);
            if (!target) throw new Error('未找到该节令');
            if (!target.answerable) throw new Error(target.answerStatus);
            if (target.wrongOptions.includes(optionIndex)) throw new Error('该选项已被判定错误');
            // Refresh-time checks alone do not cover disabling automation during a query.
            assertConnected('节令答题');
            if (!canProceed()) throw new Error('节令答题自动领取已关闭');
            const currentTime = now();
            const config = solarTermsConfig.get(termId);
            if (currentTime < target.startTime || currentTime > target.endTime
                || currentTime < config.startTime || currentTime > config.endTime) throw new Error('节令答题已不在活动时间内');
            const request = types.AnswerSolarTermsRequest.encode(types.AnswerSolarTermsRequest.create({
                id: termId, option_index: optionIndex,
            })).finish();
            // Do not retry a mutation if the transport result is uncertain.
            const { body } = await send(SERVICE, 'AnswerSolarTerms', request);
            const reply = types.AnswerSolarTermsReply.decode(body);
            let term = normalizeEvent(reply.updated_event, before.nowTime);
            if (!term || term.id !== termId) term = { ...target };
            term = { ...term, quizClaimed: !!reply.correct || term.quizClaimed,
                quizWrongToday: !reply.correct || term.quizWrongToday, answerable: false,
                answerStatus: reply.correct ? '答题奖励已领取' : '今日答错，明日再试' };
            let solarTerms = summarize(before.terms.map(item => item.id === termId ? term : item), before.nowTime);
            try { solarTerms = await getInfo(); }
            catch (error) { solarTerms.warning = `答题已提交，状态刷新失败：${error.message}`; }
            return { ok: true, correct: !!reply.correct, rewards: (reply.rewards || []).map(mapItem), term, solarTerms };
        } finally { answering = false; }
    }

    async function autoClaim({ enabled, onResult, onError }) {
        if (!enabled()) return;
        let info;
        try { info = await getInfo(); }
        catch (error) { onError(error); return; }
        for (const term of info.terms) {
            if (!enabled()) break;
            if (!term.answerable || term.correctOptionIndex === null || term.wrongOptions.includes(term.correctOptionIndex)) continue;
            try { onResult(await answer(term.id, term.correctOptionIndex, enabled), term); }
            catch (error) { onError(error, term); }
        }
    }

    return { getInfo, answer, autoClaim, normalizeEvent };
}

module.exports = { createSolarTermsService };
