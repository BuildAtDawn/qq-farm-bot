const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getMutantDisplayPlantId,
    getMutantPlantImageByPhase,
    getPlantImageByPhase,
} = require('../src/config/gameConfig');
const { findSpinePhaseRegion } = require('../scripts/extract-plant-phase-images');

test('森野黄金芽提取阶段整图，不能把成熟动画数字零件当成生长阶段', () => {
    for (let phase = 2; phase <= 5; phase++) {
        const normal = new Map([[`0${phase}`, {}], [`${phase}jie`, {}]]);
        const mutant = new Map([[`0${phase}`, {}], [`pt_sz_${phase}`, {}]]);
        assert.equal(findSpinePhaseRegion(normal, phase, 'Crop_9005', 'Crop_1029005'), `${phase}jie`);
        assert.equal(findSpinePhaseRegion(mutant, phase, 'Plant_1028005', 'Crop_1028005'), `pt_sz_${phase}`);
        assert.equal(findSpinePhaseRegion(new Map([['grow_02', {}]]), 2, 'Crop_9003', ''), 'grow_02');
    }
});

test('森野黄金芽四个品种使用各自完整阶段图，不再把变异回退到普通版', () => {
    const sources = require('../src/gameConfig/plant_images/milk-tea-phase-sources.json');
    for (const id of [1029005, 1129005, 1028005, 1128005]) {
        const asset = id === 1029005 ? 'Crop_9005' : `Plant_${id}`;
        for (let phase = 2; phase <= 5; phase++) {
            const url = getPlantImageByPhase(id, phase);
            assert.equal(url, `/game-config/plant_images/${asset}/${phase}.png`);
            const bytes = fs.readFileSync(path.join(__dirname, '..', 'src', url.replace('/game-config/', 'gameConfig/')));
            // 错误零件只有几十像素；完整阶段图的双边均超过100像素。
            assert.ok(bytes.readUInt32BE(16) > 100 && bytes.readUInt32BE(20) > 100, `${asset}/${phase}`);
            const source = sources.items.find(item => item.asset === asset && item.phase === phase);
            assert.equal(source.atlasRegion, [1028005, 1128005].includes(id) ? `pt_sz_${phase}` : `${phase}jie`);
            assert.equal(source.file, `${asset}/${phase}.png`);
        }
    }
});

test('活动植物按阶段返回官方植物图片', () => {
    const image = getPlantImageByPhase(1021037, 6);
    assert.equal(image, '/game-config/plant_images/Crop_1037/6.png');
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', image.replace('/game-config/', 'gameConfig/'))), true);
});

test('2x2 Spine 活动植物可返回完整的静态阶段图', () => {
    assert.equal(getPlantImageByPhase(1029003, 1), '/game-config/plant_images/common/seed.png');
    for (let phase = 2; phase <= 7; phase += 1) {
        const image = getPlantImageByPhase(1029003, phase);
        assert.equal(image, `/game-config/plant_images/Crop_9003/${phase}.png`);
        assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', image.replace('/game-config/', 'gameConfig/'))), true);
    }
});

test('所有作物的土地种子阶段共用客户端通用种子贴图', () => {
    const seedImage = '/game-config/plant_images/common/seed.png';
    assert.equal(getPlantImageByPhase(1020128, 1), seedImage);
    assert.equal(getPlantImageByPhase(1026032, 1), seedImage);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', seedImage.replace('/game-config/', 'gameConfig/'))), true);
});

test('变异植物映射优先选择完整组合', () => {
    assert.equal(getMutantDisplayPlantId(1029003, [5]), 1129003);
    assert.equal(getMutantDisplayPlantId(1029003, [11]), 1028003);
    assert.equal(getMutantDisplayPlantId(1029003, [5, 11]), 1128003);
    assert.equal(getMutantDisplayPlantId(1028003, [5, 11]), 1128003);
    assert.equal(getMutantDisplayPlantId(1029004, [16]), 1028004);
    assert.equal(getMutantDisplayPlantId(1029004, [5, 16]), 1128004);
    assert.equal(getMutantDisplayPlantId(1028004, [5, 16]), 1128004);
});

test('变异植物使用专属阶段图并在缺失时回退原作物', () => {
    assert.equal(
        getMutantPlantImageByPhase(1028003, [5, 11], 7),
        '/game-config/plant_images/Plant_1128003/7.png',
    );
    assert.equal(
        getMutantPlantImageByPhase(1029003, [5], 6),
        '/game-config/plant_images/Plant_1129003/6.png',
    );
    assert.equal(
        getMutantPlantImageByPhase(1029004, [16], 6),
        '/game-config/plant_images/Plant_1028004/6.png',
    );
    assert.equal(
        getMutantPlantImageByPhase(1029004, [5, 16], 6),
        '/game-config/plant_images/Plant_1128004/6.png',
    );
});

test('乐园变异包含本地官方阶段素材', () => {
    for (const [plantId, mutantIds] of [[1029004, [16]], [1029004, [5, 16]]]) {
        for (let phase = 2; phase <= 7; phase += 1) {
            const image = getMutantPlantImageByPhase(plantId, mutantIds, phase);
            assert.match(image, /^\/game-config\/plant_images\/Plant_/);
            assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', image.replace('/game-config/', 'gameConfig/'))), true);
        }
    }
});

test('supplemental crops resolve local seed icons and every growth phase', () => {
    const { getPlantBySeedId, getSeedImageBySeedId } = require('../src/config/gameConfig');
    for (const [seedId, asset, size] of [[20516, 'Crop_516', 1], [25995, 'Crop_5995', 1], [29004, 'Crop_9004', 2], [20522, 'Crop_522', 1], [20523, 'Crop_523', 1]]) {
        const plant = getPlantBySeedId(seedId);
        assert.equal(plant?.size, size);
        const seedImage = getSeedImageBySeedId(seedId);
        assert.equal(seedImage, `/game-config/seed_images_named/${seedId}_${asset}_Seed.png`);
        const images = [seedImage];
        assert.equal(getPlantImageByPhase(plant.id, 1), '/game-config/plant_images/common/seed.png');
        for (let phase = 2; phase <= (size === 2 ? 7 : 6); phase += 1) {
            const image = getPlantImageByPhase(plant.id, phase);
            assert.equal(image, `/game-config/plant_images/${asset}/${phase}.png`);
            images.push(image);
        }
        for (const image of images) {
            const bytes = fs.readFileSync(path.join(__dirname, '..', 'src', image.replace('/game-config/', 'gameConfig/')));
            assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        }
    }
});

test('新增图鉴作物及变异均提供土地阶段图和正确占地', () => {
    const { getPlantByFruitId, getPlantBySeedId } = require('../src/config/gameConfig');
    const fruits = [41435, 49005, 42254, 1040021, 1040525, 1040526, 1040527, 1040528, 1040165, 1040435, 1040529, 204011, 204012, 1049005];
    for (const fruit of fruits) {
        const plant = getPlantByFruitId(fruit);
        assert.ok(plant, `果实 ${fruit} 的植物配置`);
        assert.equal(plant.size, [49005, 204011, 204012, 1049005].includes(fruit) ? 2 : 1);
        for (let phase = 1; phase <= 6; phase++) {
            const url = getPlantImageByPhase(plant.id, phase);
            assert.ok(url, `${plant.name} 阶段 ${phase}`);
            const bytes = fs.readFileSync(path.join(__dirname, '..', 'src', url.replace('/game-config/', 'gameConfig/')));
            assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        }
    }
    assert.equal(getPlantBySeedId(29005).size, 2);
    for (const [base, effects, target] of [
        [1020525, [5], 1120525], [1020021, [5], 1120021],
        [1020165, [5], 1120165], [1020435, [5], 1120435],
        [1029005, [5], 1129005], [1029005, [17], 1028005],
        [1029005, [5, 17], 1128005], [1028005, [5, 17], 1128005],
    ]) {
        assert.equal(getMutantDisplayPlantId(base, effects), target);
        assert.equal(getMutantPlantImageByPhase(base, effects, 6), getPlantImageByPhase(target, 6));
        assert.notEqual(getPlantImageByPhase(target, 6), getPlantImageByPhase(base, 6));
    }
});

test('新增土地阶段素材来源清单和本地摘要一致', () => {
    const crypto = require('node:crypto');
    const root = path.join(__dirname, '../src/gameConfig/plant_images');
    const sources = require('../src/gameConfig/plant_images/milk-tea-phase-sources.json');
    for (const item of sources.items) {
        assert.match(item.sourceUrl, /^https:\/\/cdn-resource\.nqf\.qq\.com\//);
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, item.file))).digest('hex'), item.sha256);
    }
});
