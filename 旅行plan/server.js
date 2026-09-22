import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname);
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const envPath = join(root, ".env");

function loadEnv() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[2].startsWith("#") || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadEnv();
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "travel-plan.db"));
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS days (
    id INTEGER PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    day_number INTEGER NOT NULL,
    date TEXT NOT NULL,
    label TEXT NOT NULL,
    route TEXT NOT NULL,
    summary TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    lng REAL NOT NULL,
    lat REAL NOT NULL,
    photo_query TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stops (
    id INTEGER PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    time_label TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待确认',
    location_id INTEGER REFERENCES locations(id)
  );
  CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    mode TEXT NOT NULL,
    label TEXT NOT NULL,
    detail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '待确认',
    from_location_id INTEGER NOT NULL REFERENCES locations(id),
    to_location_id INTEGER NOT NULL REFERENCES locations(id)
  );
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function seed() {
  if (db.prepare("SELECT COUNT(*) AS count FROM trips").get().count) return;
  db.prepare("INSERT INTO trips (id,title,subtitle,start_date,end_date) VALUES (1,?,?,?,?)")
    .run("我和爱妻的旅行路线", "烟台 · 哈尔滨 · 齐齐哈尔 · 呼伦贝尔", "2026-10-02", "2026-10-08");
  const putLocation = db.prepare("INSERT INTO locations (id,name,address,lng,lat,photo_query) VALUES (?,?,?,?,?,?)");
  const locations = [
    [1,"哈尔滨太平国际机场","黑龙江省哈尔滨市道里区太平镇",126.250,45.623,"哈尔滨太平国际机场"],
    [2,"哈尔滨自有住处","哈尔滨城区，具体地址待补充",126.638,45.756,"哈尔滨 秋天"],
    [3,"哈尔滨站","黑龙江省哈尔滨市南岗区铁路街1号",126.632,45.759,"哈尔滨站"],
    [4,"齐齐哈尔站","黑龙江省齐齐哈尔市铁锋区站前大街",123.979,47.342,"齐齐哈尔站"],
    [5,"齐齐哈尔烤肉","齐齐哈尔市区，门店待确认",123.948,47.350,"齐齐哈尔烤肉"],
    [6,"龙沙公园","黑龙江省齐齐哈尔市龙沙区公园路",123.955,47.338,"齐齐哈尔 龙沙公园 秋天"],
    [7,"海拉尔站","内蒙古自治区呼伦贝尔市海拉尔区",119.765,49.224,"海拉尔站"],
    [8,"海拉尔取还车门店","海拉尔站附近，门店待确认",119.767,49.226,"海拉尔 租车"],
    [9,"额尔古纳湿地景区","内蒙古自治区呼伦贝尔市额尔古纳市",120.177,50.245,"额尔古纳湿地 秋天"],
    [10,"额尔古纳市区住宿","拉布大林街道，酒店待确认",120.181,50.245,"额尔古纳 秋天"],
    [11,"敖鲁古雅使鹿部落","内蒙古自治区呼伦贝尔市根河市敖鲁古雅乡",121.564,50.807,"敖鲁古雅 驯鹿 秋天"],
    [12,"根河市区住宿","根河市区，酒店待确认",121.520,50.780,"根河 秋天"],
    [13,"海拉尔站附近住宿","海拉尔站周边，酒店待确认",119.763,49.220,"海拉尔 秋天"]
  ];
  const putDay = db.prepare("INSERT INTO days (id,trip_id,day_number,date,label,route,summary) VALUES (?,?,?,?,?,?,?)");
  const days = [
    [1,1,1,"2026-10-02","10月2日","烟台 → 哈尔滨","抵达后回自己的住处"],
    [2,1,2,"2026-10-03","10月3日","哈尔滨 → 齐齐哈尔 → 海拉尔","吃齐齐哈尔烤肉，夜车去海拉尔"],
    [3,1,3,"2026-10-04","10月4日","海拉尔 → 额尔古纳","取车，沿草原和湿地到额尔古纳"],
    [4,1,4,"2026-10-05","10月5日","额尔古纳 → 根河","森林公路，下午看驯鹿"],
    [5,1,5,"2026-10-06","10月6日","根河 → 海拉尔","返程日，傍晚前到海拉尔"],
    [6,1,6,"2026-10-07","10月7日","海拉尔 → 哈尔滨","还车后，按返程火车票安排"],
    [7,1,7,"2026-10-08","10月8日","哈尔滨","抵达哈尔滨，行程结束"]
  ];
  const putStop = db.prepare("INSERT INTO stops (day_id,sort_order,time_label,kind,title,detail,status,location_id) VALUES (?,?,?,?,?,?,?,?)");
  const stops = [
    [1,1,"航班待确认","flight","烟台飞哈尔滨","航班号与时间待确认","待确认",1],[1,2,"夜间","stay","住自己的住处","哈尔滨，具体地址待补充","待确认",2],
    [2,1,"09:38 · 待核票","rail","哈尔滨站出发","原计划 D6901，购票前在 12306 核对","待确认",3],[2,2,"12:00–14:00","food","齐齐哈尔烤肉","现拌牛肉、牛胸口、烤酸菜；门店待确认","待确认",5],[2,3,"下午","play","龙沙公园","午餐后散步，晚上留足时间回车站","待确认",6],[2,4,"22:35 · 待核票","rail","齐齐哈尔去海拉尔","原计划 K7089，车次与铺位待确认","待确认",4],
    [3,1,"08:00–09:00","car","海拉尔站附近取车","火车到站后取车，检查车况和油量","待确认",8],[3,2,"下午","play","额尔古纳湿地景区","看湿地秋色，开放时间临行前核对","待确认",9],[3,3,"夜间","stay","住额尔古纳市区","选有停车位、供暖可靠的酒店","待确认",10],
    [4,1,"上午","car","额尔古纳去根河","森林公路慢行，按天气和路况停车","待确认",11],[4,2,"下午","play","敖鲁古雅使鹿部落","看驯鹿与鄂温克文化","待确认",11],[4,3,"夜间","stay","住根河市区","选有停车位、供暖可靠的酒店","待确认",12],
    [5,1,"上午至下午","car","根河返回海拉尔","以赶路为主，按路况安排停留","待确认",7],[5,2,"夜间","stay","住海拉尔站附近","为第二天还车和返程留出余地","待确认",13],
    [6,1,"按返程票确定","car","海拉尔站附近还车","发车前至少 2–3 小时完成还车","待确认",8],[6,2,"夜间 · 车次待定","rail","海拉尔回哈尔滨","返程车次待你买票后补充","待确认",7],
    [7,1,"时间待定","rail","到达哈尔滨","以最终返程车票为准","待确认",3]
  ];
  db.exec("BEGIN");
  try { locations.forEach(row => putLocation.run(...row)); days.forEach(row => putDay.run(...row)); stops.forEach(row => putStop.run(...row)); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
seed();

// 10 月 3 日齐齐哈尔取车，先走呼伦贝尔北线，最后两天压到阿尔山，10 月 8 日回齐齐哈尔还车。
const itineraryVersion = "qiqihar-rental-northline-aershan-2026-09-22-v8";
function refreshNorthlineDraft() {
  const savedVersion = db.prepare("SELECT value FROM app_meta WHERE key='itinerary_version'").get()?.value;
  if (savedVersion === itineraryVersion) return;
  const locations = [
    [1,"烟台蓬莱国际机场","山东省烟台市蓬莱区潮水镇",120.987,37.657,"烟台蓬莱国际机场"],
    [2,"哈尔滨太平国际机场","黑龙江省哈尔滨市道里区太平镇",126.250,45.623,"哈尔滨十月"],
    [3,"哈尔滨剑桥学院15号楼留学生宿舍","哈尔滨市香坊区哈平路239号，哈尔滨剑桥学院15号楼留学生宿舍",126.660,45.656,"哈尔滨剑桥学院 秋天"],
    [4,"哈尔滨站","黑龙江省哈尔滨市南岗区铁路街1号",126.632,45.759,"哈尔滨十月"],
    [5,"齐齐哈尔站","黑龙江省齐齐哈尔市铁锋区站前大街",123.979,47.342,"齐齐哈尔十月"],
    [6,"齐齐哈尔烤肉门店","齐齐哈尔市区，等你们定具体门店",123.948,47.350,"齐齐哈尔十月"],
    [7,"龙沙公园","黑龙江省齐齐哈尔市龙沙区公园路",123.955,47.338,"齐齐哈尔十月"],
    [8,"海拉尔站","内蒙古自治区呼伦贝尔市海拉尔区",119.765,49.224,"海拉尔十月"],
    [9,"海拉尔租车门店","海拉尔站附近，等预订时定门店",119.767,49.226,"海拉尔十月"],
    [10,"莫日格勒河观景点","内蒙古自治区呼伦贝尔市陈巴尔虎旗莫日格勒河草原",119.645,49.472,"莫日格勒河十月"],
    [11,"额尔古纳湿地景区","内蒙古自治区呼伦贝尔市额尔古纳市拉布大林街道",120.177,50.245,"额尔古纳湿地十月"],
    [12,"额尔古纳市区住宿","额尔古纳市拉布大林街道，建议选停车方便的酒店",120.181,50.245,"额尔古纳十月"],
    [13,"白桦林景区","内蒙古自治区呼伦贝尔市额尔古纳市201省道附近",120.831,50.887,"额尔古纳白桦林十月"],
    [14,"恩和俄罗斯族民族乡","内蒙古自治区呼伦贝尔市额尔古纳市恩和哈乌尔河镇",119.911,50.778,"恩和十月"],
    [15,"恩和住宿","恩和俄罗斯族民族乡，建议住木刻楞民宿",119.911,50.778,"恩和十月"],
    [16,"室韦临江界河观景点","内蒙古自治区呼伦贝尔市额尔古纳市室韦镇",119.955,51.859,"室韦十月"],
    [17,"黑山头镇","内蒙古自治区呼伦贝尔市额尔古纳市黑山头镇",119.700,50.205,"黑山头十月"],
    [18,"黑山头住宿","黑山头镇，建议选供暖和停车都稳定的住宿",119.700,50.205,"黑山头十月"],
    [19,"186彩带河景区","内蒙古自治区呼伦贝尔市额尔古纳市黑山头镇附近",119.698,50.032,"186彩带河十月"],
    [20,"海拉尔河西早市","内蒙古自治区呼伦贝尔市海拉尔区环卫二路百合家园南门附近",119.751,49.219,"海拉尔十月"],
    [21,"海拉尔河西住宿","海拉尔河西，建议选靠近早市或车站的酒店",119.760,49.223,"海拉尔十月"],
    [22,"阿尔山火车站与温泉街","内蒙古自治区兴安盟阿尔山市温泉街",119.941,47.170,"阿尔山火车站 秋天"],
    [23,"阿尔山国家森林公园金江沟游客中心","内蒙古自治区兴安盟阿尔山市天池镇",120.293,47.273,"阿尔山国家森林公园 秋天"],
    [24,"阿尔山天池","阿尔山国家森林公园天池景区",120.410,47.350,"阿尔山天池 秋天"],
    [25,"驼峰岭天池","阿尔山国家森林公园天池片区",120.420,47.480,"驼峰岭天池 秋天"],
    [26,"石塘林与龟背岩","阿尔山国家森林公园石塘林景区",120.300,47.240,"阿尔山石塘林 秋天"],
    [27,"杜鹃湖","阿尔山国家森林公园杜鹃湖景区",120.525,47.420,"阿尔山杜鹃湖 秋天"],
    [28,"不冻河","阿尔山国家森林公园不冻河景区",120.160,47.080,"阿尔山不冻河 秋天"],
    [29,"阿尔山/伊尔施住宿","阿尔山市区或伊尔施镇，优先供暖与停车",119.945,47.175,"阿尔山住宿 秋天"],
    [30,"玫瑰峰","内蒙古自治区兴安盟阿尔山市玫瑰峰景区",119.740,47.260,"阿尔山玫瑰峰 秋天"],
    [31,"齐齐哈尔租车门店","齐齐哈尔站附近，具体门店待确认",123.979,47.342,"齐齐哈尔租车门店"]
  ];
  const days = [
    [1,1,1,"2026-10-02","10月2日","烟台 → 哈尔滨","飞机抵达哈尔滨，打车回自己的住处"],
    [2,1,2,"2026-10-03","10月3日","哈尔滨 → 齐齐哈尔取车 → 海拉尔","D6901 到齐齐哈尔后取车，长途自驾到海拉尔"],
    [3,1,3,"2026-10-04","10月4日","海拉尔 → 莫日格勒河 → 额尔古纳","先看草原曲水，再到湿地，住额尔古纳"],
    [4,1,4,"2026-10-05","10月5日","额尔古纳 → 白桦林 → 黑山头","白桦林短停，下午到黑山头看河湾与日落"],
    [5,1,5,"2026-10-06","10月6日","黑山头 → 186彩带河 → 阿尔山","上午看黑山头，顺路停186，下午长途南下阿尔山"],
    [6,1,6,"2026-10-07","10月7日","阿尔山国家森林公园一日","整天留给火山森林核心景观，不再安排跨城长途"],
    [7,1,7,"2026-10-08","10月8日","阿尔山 → 齐齐哈尔午餐游玩 → 还车返哈","上午回齐齐哈尔，中午吃饭，下午玩够再还车坐火车"]
  ];
  const stops = [
    [1,1,"航班二选一","flight","蓬莱机场 → 太平机场","深航 ZH9675 或青岛航 QW6098，按你们最终选择出票","待确认",1],[1,2,"抵达后","taxi","机场打车去剑桥学院","到哈尔滨剑桥学院15号楼留学生宿舍","待确认",2],[1,3,"夜间","stay","住哈尔滨剑桥学院15号楼","哈尔滨市香坊区哈平路239号，宿舍楼号按校内指引确认","待确认",3],
    [2,1,"09:38 · 已购","rail","哈尔滨站 → 齐齐哈尔站","D6901 已买票，抵达后取行李并处理寄存","已确认",4],[2,2,"中午","food","齐齐哈尔烤肉","预算 200；门店到站后确定","待确认",6],[2,3,"午后","car","齐齐哈尔取车","站附近取车，验车、拍照、确认油量后上路","待确认",31],[2,4,"下午至夜间","car","齐齐哈尔 → 海拉尔","约 600+ 公里，预计 7–8 小时；到海拉尔后入住","待确认",8],[2,5,"夜间","stay","住海拉尔","先保证休息，第二天再开始北线景点","待确认",21],
    [3,1,"上午","car","海拉尔 → 莫日格勒河","取车后沿草原公路北上，天气不好缩短非铺装路段","待确认",10],[3,2,"中午","play","莫日格勒河","保留最重要的草原曲水视角，不硬闯非铺装路","待确认",10],[3,3,"下午","car","莫日格勒河 → 额尔古纳","下午前往额尔古纳市区","待确认",11],[3,4,"傍晚","play","额尔古纳湿地","登高看根河湿地，开放时间临行前核对","待确认",11],[3,5,"夜间","stay","住额尔古纳市区","选有停车、供暖和早餐的酒店","待确认",12],
    [4,1,"上午","car","额尔古纳 → 白桦林","早点出发，保留白桦林秋色","待确认",13],[4,2,"上午至中午","play","白桦林景区","短停拍照，现场道路和开放情况优先","待确认",13],[4,3,"沿途 · 条件项","play","草原瑞士卷","看到安全停车点再拍，不追固定坐标","条件项",null],[4,4,"下午","car","白桦林 → 黑山头","沿额尔古纳河方向南下","待确认",17],[4,5,"日落前","play","黑山头与额尔古纳河","北线主景，天气好再看日落","待确认",17],[4,6,"夜间","stay","住黑山头","优先确认供暖与停车","待确认",18],
    [5,1,"上午","play","黑山头草原与河湾","早起看光线，保留黑山头主景","待确认",17],[5,2,"中午前后 · 条件项","play","186彩带河","开放和时间允许再停；它是本日第一删减项","条件项",19],[5,3,"下午至夜间","car","黑山头 → 阿尔山","本日最长驾驶段，午后直接南下，晚上入住阿尔山","待确认",29],[5,4,"夜间","stay","住阿尔山/伊尔施","第二天不再跨城，优先保证睡眠和停车","待确认",29],
    [6,1,"早上","car","进入阿尔山国家森林公园","整天看园区核心，不安排返程长途","待确认",23],[6,2,"上午","play","阿尔山天池","火山口湖，按现场开放和体力取舍","待确认",24],[6,3,"中午","play","驼峰岭天池","阿尔山核心景观，保留完整栈道时间","待确认",25],[6,4,"下午","play","石塘林与龟背岩","熔岩地貌，下午光线好时安排","待确认",26],[6,5,"傍晚 · 条件项","play","杜鹃湖 / 不冻河","二选一，不为凑景点赶夜路","条件项",27],[6,6,"夜间","stay","住阿尔山/伊尔施","第二天清早开回齐齐哈尔","待确认",29],
    [7,1,"清晨","car","阿尔山 → 齐齐哈尔","上午完成返程，预留路况缓冲","待确认",31],[7,2,"中午","food","齐齐哈尔烤肉","回城后先吃饭，预算 200","待确认",6],[7,3,"下午","play","龙沙公园","下午玩够再还车，不再赶海拉尔方向","待确认",7],[7,4,"下午晚些","car","齐齐哈尔租车门店还车","完成油量、外观和押金核验","待确认",31],[7,5,"晚间 · 待购票","rail","齐齐哈尔 → 哈尔滨","还车后打车到齐齐哈尔站，再坐火车回哈尔滨","待确认",5]
  ];
  const segments = [
    [1,1,1,"flight","蓬莱机场 → 太平机场（航班二选一）","深航 ZH9675 / 青岛航 QW6098，最终按你们选择","待确认",1,2],[2,1,2,"taxi","太平机场 → 剑桥学院宿舍","机场到哈尔滨剑桥学院15号楼留学生宿舍","待确认",2,3],
    [3,2,1,"taxi","剑桥学院宿舍 → 哈尔滨站","打车去哈尔滨站","待确认",3,4],[4,2,2,"rail","哈尔滨 → 齐齐哈尔","D6901 已购","已确认",4,5],[5,2,3,"walk","齐齐哈尔站 → 烤肉","门店确定后再校正步行线","待确认",5,6],[6,2,4,"taxi","烤肉 → 齐齐哈尔租车门店","吃完饭前往取车","待确认",6,31],[7,2,5,"drive","齐齐哈尔 → 海拉尔","取车后全程自驾，约 600+ 公里","待确认",31,8],[8,2,6,"drive","抵达海拉尔 → 住宿","到城后入住休息","待确认",8,21],
    [9,3,1,"drive","海拉尔 → 莫日格勒河","北上草原公路","待确认",21,10],[10,3,2,"drive","莫日格勒河 → 额尔古纳湿地","下午进入额尔古纳","待确认",10,11],[11,3,3,"drive","额尔古纳湿地 → 市区住宿","傍晚入住","待确认",11,12],
    [12,4,1,"drive","额尔古纳 → 白桦林","早出发，短停拍照","待确认",12,13],[13,4,2,"drive","白桦林 → 黑山头","沿额尔古纳河方向南下","待确认",13,17],[14,4,3,"drive","黑山头 → 住宿","看完河湾入住黑山头","待确认",17,18],
    [15,5,1,"drive","黑山头 → 186彩带河","顺路南下，开放和时间允许再停","条件项",18,19],[16,5,2,"drive","186彩带河 → 阿尔山住宿","下午直接南下阿尔山，晚上入住","待确认",19,29],
    [17,6,1,"drive","阿尔山住宿 → 金江沟游客中心","整天进入阿尔山国家森林公园","待确认",29,23],[18,6,2,"drive","金江沟 → 阿尔山天池","园内接驳/短途自驾，以当天规则为准","待确认",23,24],[19,6,3,"drive","阿尔山天池 → 驼峰岭天池","园内移动","待确认",24,25],[20,6,4,"drive","驼峰岭天池 → 石塘林","下午安排熔岩地貌","待确认",25,26],[21,6,5,"drive","石塘林 → 阿尔山住宿","回同一住宿点","待确认",26,29],
    [22,7,1,"drive","阿尔山住宿 → 齐齐哈尔租车门店","上午返程，争取中午前后到齐齐哈尔","待确认",29,31],[23,7,2,"drive","租车门店 → 齐齐哈尔烤肉","还车前先把午饭解决","待确认",31,6],[24,7,3,"drive","齐齐哈尔烤肉 → 龙沙公园","下午游玩","待确认",6,7],[25,7,4,"drive","龙沙公园 → 租车门店","玩够后回门店还车","待确认",7,31],[26,7,5,"taxi","租车门店 → 齐齐哈尔站","还车后打车去车站","待确认",31,5],[27,7,6,"rail","齐齐哈尔 → 哈尔滨","车次待购，按还车时间倒推","待确认",5,4]
  ];
  const putTrip = db.prepare("INSERT INTO trips (id,title,subtitle,start_date,end_date) VALUES (1,?,?,?,?)");
  const putLocation = db.prepare("INSERT INTO locations (id,name,address,lng,lat,photo_query) VALUES (?,?,?,?,?,?)");
  const putDay = db.prepare("INSERT INTO days (id,trip_id,day_number,date,label,route,summary) VALUES (?,?,?,?,?,?,?)");
  const putStop = db.prepare("INSERT INTO stops (id,day_id,sort_order,time_label,kind,title,detail,status,location_id) VALUES (?,?,?,?,?,?,?,?,?)");
  const putSegment = db.prepare("INSERT INTO segments (id,day_id,sort_order,mode,label,detail,status,from_location_id,to_location_id) VALUES (?,?,?,?,?,?,?,?,?)");
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM segments; DELETE FROM stops; DELETE FROM days; DELETE FROM locations; DELETE FROM trips;");
    putTrip.run("我和爱妻的旅行路线", "阿尔山火山森林 · 呼伦贝尔草原与湿地", "2026-10-02", "2026-10-08");
    locations.forEach(row => putLocation.run(...row)); days.forEach(row => putDay.run(...row)); stops.forEach((row,index) => putStop.run(index + 1,...row)); segments.forEach(row => putSegment.run(...row));
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES ('itinerary_version',?)").run(itineraryVersion);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
refreshNorthlineDraft();

// 只收录来源页面明确标注为十月或国庆期间的实拍图；交通节点复用所在城市的十月图。
const octoberGallery = {
  airport: [
    { imageUrl: "https://upload.wikimedia.org/wikipedia/commons/9/94/Harbin_Taiping_International_Airport_6-May-2019.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:Harbin_Taiping_International_Airport_6-May-2019.jpg", caption: "哈尔滨太平国际机场航站楼实景" }
  ],
  qiqiharTransport: [
    { imageUrl: "https://upload.wikimedia.org/wikipedia/commons/8/87/%E9%BD%90%E9%BD%90%E5%93%88%E5%B0%94%E7%AB%99%EF%BC%882023%E5%B9%B43%E6%9C%88%EF%BC%89.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:%E9%BD%90%E9%BD%90%E5%93%88%E5%B0%94%E7%AB%99%EF%BC%882023%E5%B9%B43%E6%9C%88%EF%BC%89.jpg", caption: "齐齐哈尔站 · 取车位置附近实景" }
  ],
  morigele: [
    { imageUrl: "https://www.xinhuanet.com/photo/2021-07/22/1127681604_16269205704431n.jpg", sourceUrl: "https://www.xinhuanet.com/photo/2021-07/22/c_1127681604.htm", caption: "莫日格勒河草原航拍" }
  ],
  birchForest: [
    { imageUrl: "https://www3.xinhuanet.com/travel/20220628/1bb20330caa14b5cbf58ed42f06de1b3/202206281bb20330caa14b5cbf58ed42f06de1b3_20220628b06ac5404eb740ba873fbf8934af7d0f.jpg", sourceUrl: "https://www3.xinhuanet.com/travel/20220628/1bb20330caa14b5cbf58ed42f06de1b3/c.html", caption: "额尔古纳白桦林景区实景" }
  ],
  heishantou: [
    { imageUrl: "https://upload.wikimedia.org/wikipedia/commons/b/be/%E9%A2%9D%E5%B0%94%E5%8F%A4%E7%BA%B3_%E8%88%AA%E6%8B%8D%E9%BB%91%E5%B1%B1%E5%A4%B4%E9%95%87%E4%B9%8B%E8%8D%89%E5%8E%9F%E5%9C%A8%E8%BF%99%E9%87%8C%E6%99%AF%E5%8C%BA_01.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:%E9%A2%9D%E5%B0%94%E5%8F%A4%E7%BA%B3_%E8%88%AA%E6%8B%8D%E9%BB%91%E5%B1%B1%E5%A4%B4%E9%95%87%E4%B9%8B%E8%8D%8E%E5%8E%9F%E5%9C%A8%E8%BF%99%E9%87%8C%E6%99%AF%E5%8C%BA_01.jpg", caption: "黑山头草原与河湾航拍" }
  ],
  harbin: [
    { imageUrl: "https://www.hljnews.cn/whly/pic/2024-10/28/809267_569cd832-3412-4f9b-9fe6-e06006ca61d8.jpg", sourceUrl: "https://www.hljnews.cn/whly/content/2024-10/28/content_809267.html", caption: "2024年10月27日 · 哈尔滨公园秋景" },
    { imageUrl: "https://www.hljnews.cn/whly/pic/2024-10/28/809267_7c1d6168-2582-4bd8-8d23-0352776da3cd.jpg", sourceUrl: "https://www.hljnews.cn/whly/content/2024-10/28/content_809267.html", caption: "2024年10月 · 哈尔滨赏秋实拍" },
    { imageUrl: "https://www.hljnews.cn/whly/pic/2024-10/28/809267_78d9ea32-ef89-443b-beaa-7dbaed25a7d6.jpg", sourceUrl: "https://www.hljnews.cn/whly/content/2024-10/28/content_809267.html", caption: "2024年10月 · 哈尔滨秋日公园" }
  ],
  qiqihar: [
    { imageUrl: "https://p4crires.cri.cn/photoworkspace/cri/contentimg/2023/10/09/2023100916202036274.jpg", sourceUrl: "https://bulgarian.cri.cn/2023/10/09/ARTIueT6hSgjGHwpUA0F9YxQ231009.shtml", caption: "2023年10月9日 · 齐齐哈尔秋色" },
    { imageUrl: "https://i0.hdslb.com/bfs/new_dyn/48c41a59dfa37b0987f1022f92d84f3b3493265246521798.jpg", sourceUrl: "https://www.bilibili.com/opus/978180485305860105", caption: "齐齐哈尔秋日公园实拍" }
  ],
  hailaer: [
    { imageUrl: "https://xjtu.app/uploads/default/original/2X/0/0239a952e3fcbd08e45d49e5fe009ea2f0775b4c.jpeg", sourceUrl: "https://xjtu.app/t/topic/13628", caption: "国庆期间 · 海拉尔森林实拍" },
    { imageUrl: "https://ak-d.tripcdn.com/images/1mi0m12000ip20wuk1E50_C_400_10000_Q70.webp?proc=source%2Ftrip", sourceUrl: "https://sg.trip.com/travel-guide/attraction/hulunbuir/hailar-national-forest-park-82061/", caption: "海拉尔国家森林公园秋景" },
    { imageUrl: "https://img.bim99.cn/hdd/hdd1/img/102/2025-10-09/102_94bd4c703b19c1a1a908e017d5ef0a1a.webp", sourceUrl: "https://www.15386.cn/post/64910.html", caption: "2025年10月 · 海拉尔周边秋景" }
  ],
  erguna: [
    { imageUrl: "https://9338079.s21i.faiusr.com/2/ABUIABACGAAgo5uOvwUopt3E0wUwgCA4qhU%21800x800.jpg", sourceUrl: "https://esmengyuan.cn/nd.jsp?id=14", caption: "额尔古纳湿地 · 金秋航拍" },
    { imageUrl: "https://szb.northnews.cn/nmgrb/resfile/2021-10-07/04/1788344_an_1632732306992_s.jpg", sourceUrl: "https://szb.northnews.cn/nmgrb/html/2021-10/07/content_32063_162419.htm", caption: "2021年10月7日 · 额尔古纳湿地" },
    { imageUrl: "https://p0.itc.cn/q_70/images03/20221001/7aac8c3ed19045148cd562aeb3e18282.jpeg", sourceUrl: "https://www.sohu.com/a/589497189_121106854", caption: "2022年10月 · 额尔古纳秋色" }
  ],
  reindeer: [
    { imageUrl: "https://img1.qunarzz.com/travel/d9/1808/c8/ef8086cf969396b5.jpg", sourceUrl: "https://touch.travel.qunar.com/comment/5878944", caption: "十月 · 敖鲁古雅驯鹿实拍" },
    { imageUrl: "https://q2.itc.cn/q_70/images03/20250918/b4bfc12fae4544bc809a54fa4ef7958d.jpeg", sourceUrl: "https://www.sohu.com/a/936299881_121124419", caption: "敖鲁古雅秋日白桦林" },
    { imageUrl: "https://img.pconline.com.cn/images/upload/upc/tx/photoblog/1209/30/c5/14218275_14218275_1349001444739.jpg", sourceUrl: "https://dp.pconline.com.cn/photo/list_2370151.html", caption: "敖鲁古雅秋季驯鹿实拍" }
  ],
  genhe: [
    { imageUrl: "https://imagecloud.thepaper.cn/thepaper/image/221/807/775.jpg", sourceUrl: "https://www.thepaper.cn/newsDetail_forward_20412612", caption: "根河金秋航拍" },
    { imageUrl: "https://img.redocn.com/sheying/20150617/genheqiuse_4526350.jpg", sourceUrl: "https://sucai.redocn.com/ziranfengjing_4526350.html", caption: "根河秋色实拍" },
    { imageUrl: "https://dimg04.c-ctrip.com/images/100p190000016rg10B117_W_640_10000.jpg?proc=autoorient", sourceUrl: "https://you.ctrip.com/sight/genhe2955/110153.html", caption: "根河森林秋景" }
  ],
  arxan: [
    { imageUrl: "https://www.forestry.gov.cn/u/cms/www/202609/18143816tq4v.jpg", sourceUrl: "https://www.forestry.gov.cn/lyj/1/lcstly/20260918/688955.html", caption: "2026年9月 · 阿尔山杜鹃湖秋色" },
    { imageUrl: "https://www.forestry.gov.cn/u/cms/www/202609/181438561iij.jpg", sourceUrl: "https://www.forestry.gov.cn/lyj/1/lcstly/20260918/688955.html", caption: "2026年9月 · 阿尔山驼峰岭天池" },
    { imageUrl: "https://www.forestry.gov.cn/u/cms/www/202609/18143902n2fo.jpg", sourceUrl: "https://www.forestry.gov.cn/lyj/1/lcstly/20260918/688955.html", caption: "2026年9月 · 阿尔山乌苏浪子湖" }
  ]
};
function galleryFor(locationId) {
  let photos = [];
  if (locationId === 1) photos = octoberGallery.airport;
  if (locationId === 4 || locationId === 31) photos = octoberGallery.qiqiharTransport;
  if ([2,3].includes(locationId)) photos = octoberGallery.harbin;
  if ([5,6,7].includes(locationId)) photos = octoberGallery.qiqihar;
  if ([8,9,20,21].includes(locationId)) photos = octoberGallery.hailaer;
  if (locationId === 10) photos = octoberGallery.morigele;
  if ([11,12].includes(locationId)) photos = octoberGallery.erguna;
  if ([13,14,15,16].includes(locationId)) photos = octoberGallery.birchForest;
  if ([17,18,19].includes(locationId)) photos = octoberGallery.heishantou;
  if ([22,23,24,25,26,27,28,29,30].includes(locationId)) photos = octoberGallery.arxan;
  // 浏览器监听每张图片的 error 事件；主图失效后会按这里的备用地址自动替换。
  return photos.map((photo, index) => ({ ...photo, fallbackImageUrls: photos.filter((_, otherIndex) => otherIndex !== index).map(other => other.imageUrl) }));
}

const json = (res, status, payload) => { res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(payload)); };
const readJson = req => new Promise((resolveBody,reject) => { let body="";req.on("data",chunk=>{body+=chunk;if(body.length>1_000_000)req.destroy();});req.on("end",()=>{try{resolveBody(body?JSON.parse(body):{});}catch{reject(new Error("请求不是有效 JSON"));}});req.on("error",reject);});
function itinerary() {
  const trip = db.prepare("SELECT * FROM trips WHERE id=1").get();
  const days = db.prepare("SELECT * FROM days WHERE trip_id=1 ORDER BY day_number").all();
  const stopsForDay = db.prepare(`SELECT s.*,l.name AS location_name,l.address,l.lng,l.lat,l.photo_query FROM stops s LEFT JOIN locations l ON l.id=s.location_id WHERE s.day_id=? ORDER BY s.sort_order`);
  const segmentsForDay = db.prepare("SELECT * FROM segments WHERE day_id=? ORDER BY sort_order");
  const locations = db.prepare("SELECT * FROM locations ORDER BY id").all();
  return { trip, locations, days: days.map(day => ({...day,stops: stopsForDay.all(day.id),segments:segmentsForDay.all(day.id)})) };
}
function staticFile(urlPath,res) {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const filename = normalize(join(publicDir, requested));
  if (!filename.startsWith(publicDir) || !existsSync(filename)) return false;
  const mime = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png"}[extname(filename)] || "application/octet-stream";
  res.writeHead(200,{"Content-Type":mime,"Cache-Control":"no-cache"});res.end(readFileSync(filename));return true;
}
function coordinate(value) { return /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(value || ""); }
async function route(origin,destination) {
  if (!process.env.AMAP_WEB_SERVICE_KEY) return null;
  const params = new URLSearchParams({key:process.env.AMAP_WEB_SERVICE_KEY,origin,destination,show_fields:"cost,navi"});
  const response = await fetch("https://restapi.amap.com/v5/direction/driving?"+params);
  if (!response.ok) throw new Error("高德路线服务不可用");
  return response.json();
}
async function placePhoto(keywords) {
  if (!process.env.AMAP_WEB_SERVICE_KEY) return null;
  const params = new URLSearchParams({ key: process.env.AMAP_WEB_SERVICE_KEY, keywords, page_size: "1", show_fields: "photos" });
  const response = await fetch("https://restapi.amap.com/v5/place/text?" + params);
  if (!response.ok) return null;
  const data = await response.json();
  const poi = data.pois?.[0];
  const photo = poi?.photos?.[0];
  return photo?.url || null;
}
async function placePhotos(keywords) {
  if (!process.env.AMAP_WEB_SERVICE_KEY) return [];
  const params = new URLSearchParams({ key: process.env.AMAP_WEB_SERVICE_KEY, keywords, page_size: "3", show_fields: "photos" });
  const response = await fetch("https://restapi.amap.com/v5/place/text?" + params);
  if (!response.ok) return [];
  const data = await response.json();
  const sourceUrl = `https://www.amap.com/search?query=${encodeURIComponent(keywords)}`;
  return (data.pois || []).flatMap(poi => (poi.photos || []).slice(0, 2).map(photo => ({ imageUrl: photo.url, sourceUrl, caption: `${poi.name || keywords} · 图片` }))).slice(0, 3);
}
async function weather(lat, lng, date) {
  const params = new URLSearchParams({ latitude: lat, longitude: lng, daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max", timezone: "Asia/Shanghai", start_date: date, end_date: date });
  const response = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
  // Open-Meteo 只发布未来约 16 天预报；超出窗口时返回空值，页面会明确提示“尚未发布”。
  if (response.status === 400) return null;
  if (!response.ok) throw new Error("天气服务暂不可用");
  const data = await response.json();
  const daily = data.daily;
  if (!daily?.time?.length) return null;
  return { date: daily.time[0], weatherCode: daily.weather_code[0], max: daily.temperature_2m_max[0], min: daily.temperature_2m_min[0], precipitationProbability: daily.precipitation_probability_max[0] };
}
const server = createServer(async (req,res) => {
  const url = new URL(req.url,"http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") return json(res,200,{ok:true});
    if (req.method === "GET" && url.pathname === "/api/trip") return json(res,200,itinerary());
    if (req.method === "GET" && url.pathname === "/api/config") return json(res,200,{mapJsKey:process.env.AMAP_JS_KEY || "",mapSecurityCode:process.env.AMAP_JS_SECURITY_CODE || "",hasRouteService:Boolean(process.env.AMAP_WEB_SERVICE_KEY)});
    if (req.method === "GET" && url.pathname === "/api/route") { const {origin,destination}=Object.fromEntries(url.searchParams); if(!coordinate(origin)||!coordinate(destination))return json(res,400,{error:"坐标格式错误"}); const result=await route(origin,destination); return result?json(res,200,result):json(res,200,{route:null,message:"未配置 AMAP_WEB_SERVICE_KEY，地图使用直线连线"}); }
    if (req.method === "GET" && url.pathname === "/api/place-photo") { const keywords=url.searchParams.get("keywords"); if(!keywords)return json(res,400,{error:"缺少地点关键词"}); return json(res,200,{photoUrl:await placePhoto(keywords)}); }
    if (req.method === "GET" && url.pathname === "/api/october-photos") { const locationId=Number(url.searchParams.get("locationId")); if(!Number.isInteger(locationId))return json(res,400,{error:"缺少地点编号"}); const location=db.prepare("SELECT * FROM locations WHERE id=?").get(locationId); let photos=galleryFor(locationId); if(!photos.length && location) photos=await placePhotos(location.photo_query); return json(res,200,{photos}); }
    if (req.method === "GET" && url.pathname === "/api/weather") { const {lat,lng,date}=Object.fromEntries(url.searchParams); if(!/^[-+]?\d+(\.\d+)?$/.test(lat||"")||!/^[-+]?\d+(\.\d+)?$/.test(lng||"")||!/^\d{4}-\d{2}-\d{2}$/.test(date||""))return json(res,400,{error:"天气参数错误"}); return json(res,200,{weather:await weather(lat,lng,date)}); }
    const match = url.pathname.match(/^\/api\/stops\/(\d+)$/);
    if (req.method === "PATCH" && match) { const input=await readJson(req); const allowed=["time_label","title","detail","status"]; const updates=allowed.filter(k=>typeof input[k]==="string"); if(!updates.length)return json(res,400,{error:"没有可更新内容"}); const statement="UPDATE stops SET "+updates.map(k=>k+"=?").join(",")+" WHERE id=?"; db.prepare(statement).run(...updates.map(k=>input[k].trim()),Number(match[1])); return json(res,200,{ok:true,stop:db.prepare("SELECT * FROM stops WHERE id=?").get(Number(match[1]))}); }
    if (staticFile(url.pathname,res)) return;
    json(res,404,{error:"未找到页面"});
  } catch (error) { console.error(error); json(res,500,{error:error.message || "服务器错误"}); }
});
const port=Number(process.env.PORT || 3030);
const host=process.env.HOST || "127.0.0.1";
server.listen(port,host,()=>console.log(`旅行 plan 已启动：http://${host}:${port}`));
