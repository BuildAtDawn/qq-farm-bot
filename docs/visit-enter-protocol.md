# Visit Enter Protocol Parameters

## Official Source

- Inspected on 2026-10-16, using the latest complete local QQ Farm source selected by `tsdk/tsdk.wasm` modification time: 2026-10-16 11:14:56 Asia/Shanghai.
- Source directory: `1112386029_3_3443f89042dffbf93d20ced1d652d031`.
- `game.js` SHA-256: `dfb652fadd5a989a1d45774b8fdeb823eb8496ead42236c278c6e0b766d6f47e`.
- Bundle: `assets/main/index.4fbdd.js`; generated module: `chunks:///_virtual/visitpb.ts`.
- The source was copied to a temporary directory before processing. Only the obfuscation interpreter, module registration, shared protocol root, and generated visit protocol were evaluated. The game bootstrap and business modules were not executed.

## Confirmed Fields

Each field was independently encoded with sentinels 7 and 19 (strings `test-7` and `test-19`). Writer method calls confirmed scalar types; the first protobuf tag confirmed field number and wire type. These are official-encoder reconstructions, not plaintext packet captures or proof of server acceptance.

| Request | Field | Number | Type | Sentinel 7 hex |
| --- | --- | --- | --- | --- |
| Enter | host_gid | 1 | int64 | 0807 |
| Enter | reason | 2 | int32 | 1007 |
| Enter | host_type | 3 | int32 | 1807 |
| Enter | share_id | 4 | int64 | 2007 |
| Enter | share_open_id | 5 | string | 2a06746573742d37 |
| Enter | share_cfg_id | 6 | int64 | 3007 |
| Enter | share_key | 7 | string | 3a06746573742d37 |
| Enter | msgboard_entry_id | 8 | string | 4206746573742d37 |
| Leave | host_gid | 1 | int64 | 0807 |
| Leave | host_type | 2 | int32 | 1007 |

Official EnterReason values: UNKNOWN=0, BUBBLE=1, FRIEND=2, INTERACT=3, QQGROUP=4, ARK=5, MSGBOARD=6. No host_type enum labels or successful access combinations are inferred from these names.

## Complete Encoder Fixture

Input (all credentials are synthetic):

```json
{"host_gid":"9007199254740993","reason":4,"host_type":1,"share_id":"9223372036854775807","share_open_id":"test-open","share_cfg_id":"9007199254740995","share_key":"test-key","msgboard_entry_id":"test-entry"}
```

Official encoder output:

```text
0881808080808080101004180120ffffffffffffffff7f2a09746573742d6f70656e3083808080808080103a08746573742d6b6579420a746573742d656e747279
```

`core/test/friend-api-visit.test.js` checks this exact output and protobuf round-trip. The raw proto supports full int64 values; visit locks and observation caches use numeric GIDs. Sharing IDs travel as decimal strings without conversion through Number.

## Runtime Boundaries

- The debug page and its manual Enter/home endpoints were removed on 2026-10-17. Shared visit APIs, parameter validation, and official protobuf fields remain in use by friend automation.
- Existing background callers retain reason=2 and omit the optional fields. Explicit numeric zero is retained; unknown fields and invalid types/ranges are rejected before WS dispatch.
- Automatic cleanup passes the same host_type used for Enter. Leave remains best-effort and always releases the shared visit session; the debug-only strict reply/error mode was removed.
- Static recovery and offline tests do not establish whether a non-friend visit will be accepted. Real-account validation remains manual.
