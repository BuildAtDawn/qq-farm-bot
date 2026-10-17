const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    getAllSeeds,
    getItemImageById,
    getSeedImageBySeedId,
} = require('../src/config/gameConfig');

test('activity seeds fall back to existing local activity images', () => {
    const expected = new Map([
        [20525, '/activity/milk-tea/Crop_525_Seed.png'],
        [20526, '/activity/milk-tea/Crop_526_Seed.png'],
        [20527, '/activity/milk-tea/Crop_527_Seed.png'],
        [20528, '/activity/milk-tea/Crop_528_Seed.png'],
        [20021, '/activity/milk-tea/Crop_21_Seed.png'],
        [21435, '/activity/milk-tea/Crop_1435_Seed.png'],
        [20529, '/activity/milk-tea/Crop_529_Seed.png'],
        [29005, '/activity/milk-tea/Crop_9005_Seed.png'],
        [20435, '/activity/wish-sign/lily-seed.png'],
        [26030, '/activity/wish-sign/moon-beauty-seed.png'],
    ]);
    const seeds = getAllSeeds();
    for (const [id, image] of expected) {
        assert.equal(getSeedImageBySeedId(id), image);
        assert.equal(getItemImageById(id), image);
        assert.equal(seeds.find(seed => seed.seedId === id)?.image, image);
        const bytes = fs.readFileSync(path.join(__dirname, '../../web/public', image));
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
});

test('existing seed and fruit images retain their dedicated mappings', () => {
    for (const id of [21072, 21625]) {
        const image = `/game-config/seed_images_named/${id}.png`;
        assert.equal(getSeedImageBySeedId(id), image);
        assert.equal(getItemImageById(id), image);
    }
    for (const id of [40435, 46030, 1040525, 1040526, 1049005]) {
        assert.equal(getItemImageById(id), `/game-config/seed_images_named/${id}.png`);
    }
});

test('unknown and invalid image IDs remain empty', () => {
    for (const id of [0, -1, null, undefined, 'invalid', 999999999]) {
        assert.equal(getSeedImageBySeedId(id), '');
        assert.equal(getItemImageById(id), '');
    }
});
