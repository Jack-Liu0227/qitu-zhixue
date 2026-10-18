# Learning plan schedule锛氭璇炬暟閲忋€佸崟鑺傛椂闀夸笌闂撮殧澶嶄範鍋囪

`plan-generator.ts` 鎺ュ彈鏄惧紡鐨?`sessionCount: 4 | 8 | 16`锛屼互鍙婂彲閫夌殑鐗堟湰鍖?`PblSchedule`銆?
**璇炬鏄崟鍏?*锛宍weeks` 鍙槸鎺掓湡瀹瑰櫒鈥斺€斾笉鍐嶇敱 `weeks` 涔樺嚭璇炬鏁般€?

## 1. 涓夌鍏ュ弬褰㈢姸

| 璇锋眰 | 璇炬鏁?| 鍗曡妭鏃堕暱 | 姣忓懆鑺傛暟 |
| --- | ---: | ---: | ---: |
| `{ interest, weeks, sessionCount: 4 }` | **4**锛堟樉寮忥級 | 60锛堥粯璁わ級 | `4 / weeks` |
| `{ interest, weeks, sessionCount: 8 }` | **8**锛堟樉寮忥級 | 60锛堥粯璁わ級 | `8 / weeks` |
| 鏃?`{ interest, weeks, goal }` | `weeks 脳 5`锛?0 / 40锛?| 60 | 5 |
| `{ schedule: { sessionsPerWeek: 1, sessionMinutes: 120, ... } }` | `durationWeeks 脳 1` | 120 | 1 |
| `{ schedule: { sessionsPerWeek: 2, sessionMinutes: 60, ... } }` | `durationWeeks 脳 2` | 60 | 2 |

涓嶅彉閲忥細

- `sessionCount` 缁欏嚭鏃跺繀椤讳笌 `weeks 脳 姣忓懆鑺傛暟` 涓€鑷达紱鍚屾椂缁欏嚭 `schedule` 鏃惰繕瑕佷笌
  `schedule.sessionsPerWeek` 涓€鑷达紝鍚﹀垯 400 `LEARNING_PLAN_INVALID`銆?
- `schedule.durationWeeks` 蹇呴』绛変簬 `weeks`锛屼笖婊¤冻鍏变韩鐨?`PblSchedule` 鏍￠獙
  锛坄weeklyMinutes` 鎭掍负 120锛宍sessionsPerWeek 脳 sessionMinutes === weeklyMinutes`锛夈€?
- 鍚堟硶鐨勮娆℃暟闆嗗悎鍥犳姣?`{4, 8}` 鏇村ぇ锛歚4`锛? 鍛?1 鑺傦級銆乣8`锛? 鍛?2 鑺?/ 8 鍛?1 鑺傦級銆?
  `16`锛? 鍛?2 鑺傦級銆乣20` / `40`锛堥仐鐣?5 鑺?鍛級銆?

## 2. 姣忚妭浜旀

姣忚妭璇剧敱浜斾釜鍒嗘缁勬垚锛歚review`锛堝涔?瀵煎叆锛夈€乣theory`锛堢悊璁哄涔狅級銆乣check`锛堟鏌ワ級銆?
`practice`锛堝疄璺碉級銆乣reflect`锛堝弽鎬濓級銆?

- 鍞竴鐨勫垎鍧楃瓥鐣ユ槸 `sessionBlockShapeFor(sessionMinutes, ordinal)`鈥斺€斿叆鍙傛槸鍗曡妭
  鏃堕暱涓?*璇炬搴忓彿**锛堜笉鏄懆绱㈠紩锛夛紝涓ら儴鍒嗗潡褰㈢姸蹇呴』涓€鑷淬€?
- 鐞嗚璇句笉鎺?`practice` 鍒嗗潡锛堣鑺傛病鏈夊疄璺电洰鏍囷紝鑰屽疄璺靛垎鍧楀繀椤绘惡甯﹂潪绌?
  `prerequisiteObjectiveIds`锛夛紝鍏舵椂闀垮苟鍏ョ悊璁鸿瑙ｏ紝鍒嗗潡鍚堣浠嶆伆濂界瓑浜?
  `minutesPerSession`銆?
- 鏃х殑 `activity` 鎶曞奖**涓嶅彲閫?*锛歚check` 涓?`reflect` 閮芥姇鎴?`reflect`銆傞渶瑕佸尯鍒?
  鏃跺繀椤昏鍒嗗潡鐨?`kind`銆?

## 3. 闂撮殧澶嶄範鐨?*璇炬搴忓彿**鍋囪锛堥噸瑕侊級

澶嶄範闂撮殧锛坄memory: 0,1,3,7,14,30,60`锛宍design: 14,28`锛夋槸鎸?*璇炬绱㈠紩**鑰岄潪鑷劧鏃?
鏄犲皠鐨勩€傝繖涓€鍋囪鍙湪銆? 澶?鈮?1 璇炬銆嶇殑鏃у瘑搴︼紙5 鑺?鍛級涓嬭繎浼兼垚绔嬨€?

鍦?`1 脳 120` 鎺掓湡涓嬫瘡鍛ㄥ彧鏈変竴鑺傝锛屽洜姝?*涓€涓棿闅斿€?7 鎰忓懗鐫€涓冨懆锛岃€屼笉鏄竷澶?*銆?
杩欐槸褰撳墠瀹炵幇鐨勬棦鏈夎涔夛紝鏈疆**鏈?*閲嶆柊瑙ｉ噴杩欎簺搴忓垪鈥斺€旀寜鎺掓湡閲嶇畻闂撮殧闇€瑕佸崟鐙瘎瀹?
锛堟秹鍙婂涔犺皟搴︿笌鎺屾彙搴﹂棬妲涚殑浜や簰锛夈€傛澶勬樉寮忚褰曡鍋囪锛岄伩鍏嶅畠缁х画闅愬惈鍦ㄤ唬鐮侀噷銆?

鍚岀悊锛宍weeks` 涓庤娆″簭鍙风殑鎹㈢畻鍙湪 `sessionsPerWeek` 宸茬煡鏃舵墠鏈夋剰涔夛紱鏈ā鍧楃殑
鏍￠獙鍣ㄥ洜姝よ姹備袱鑰呰嚜娲斤紝鑰屼笉鏄粠鍏朵腑涓€涓帹鍙︿竴涓€?

## 4. 澶х翰锛坥utline锛夐樁娈?

璁″垝涓庛€屾瘡鑺傛暀瀛﹁鍒掋€嶄箣闂存柊澧炰竴灞傛寔涔呭寲浜х墿锛歚plan-outline.ts` 鐨?`PlanOutline`銆?

- 鍦?*纭璁″垝**鏃剁敱 `buildPlanOutline` 浠庤鍒掔粨鏋勬帹瀵硷紙绾嚱鏁帮紝鏈嶅姟绔啓锛夛紝
  閫愯妭璁板綍璇炬搴忓彿銆佸懆/鏃ャ€佺洰鏍?id銆佸垎鍧楃被鍨嬩笌鍒嗛挓鏁般€?
- 纭鍚?*涓嶅彲鍙?*锛歚assertOutlineMutable` 鎷掔粷閲嶅缓宸茬‘璁よ鍒掔殑澶х翰銆?
- 鏁欏璁″垝**鎸夎娆℃儼鎬у睍寮€**锛歚generateSessionTeachingPlan(outline, plan, sessionIndex)`
  涓€娆″彧浜у嚭涓€鑺傦紝8 鑺傝鐨勮鍒掍笉浼氶鍏堢墿鍖?8 浠芥暀瀛﹁鍒掋€?
- 骞傜瓑閿細澶х翰 `outline:<planId>`锛屾暀瀛﹁鍒?`session-plan:<planId>:<sessionIndex>`銆?
- 鍙繚鐣欑粨鏋勶紱涓嶅惈浠讳綍瀛︾敓浣滅瓟銆佸璇濇垨璇煶鍘熸枃銆?

## 5. 閬楃暀璺緞

鏃?5 鑺?鍛ㄧ綉鏍硷紙`weeks 脳 5`锛変粛鐒剁敓鎴愬苟鏍￠獙锛岄潬 `blockShapeFor` 鐨勫懆绱㈠紩琛ㄤ笌
`validateLearningPlanDraft` 鍏煎灞傚榻愩€傛柊鐨勬寜璇炬褰㈢姸璧?
`sessionBlockShapeFor`锛涗袱澶勪笉鍐嶅悇鍐欎竴濂楄鍒欍€?
