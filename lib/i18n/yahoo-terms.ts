// Chinese for the closed vocabularies Yahoo sends in English: analyst rating words, sectors, industries, insider roles and
// quote types. English pages show Yahoo's words as they come; Chinese pages look them up here and keep Yahoo's word when
// the table does not have it (Yahoo adds a word now and then). Keys ignore case, spaces and punctuation, so "Equal-Weight"
// and "Equal Weight", or "Software—Infrastructure" and "Software - Infrastructure", find the same entry.

import { yahooSectorKey } from "@/lib/sectors";
import { getSector } from "@/lib/universe";
import type { Lang } from "@/types/api";

const keyOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

function lookup(table: Readonly<Record<string, string>>, text: string, lang: Lang): string {
  if (lang !== "zh") return text;
  return table[keyOf(text)] ?? text;
}

/** Analyst ratings as brokers word them ("Overweight", "Sector Perform"). */
const RATINGS: Readonly<Record<string, string>> = {
  strongbuy: "强烈买入",
  buy: "买入",
  convictionbuy: "确信买入",
  speculativebuy: "投机性买入",
  longtermbuy: "长期买入",
  moderatebuy: "温和买入",
  toppick: "首选",
  outperform: "跑赢大盘",
  marketoutperform: "跑赢大盘",
  sectoroutperform: "跑赢行业",
  overweight: "增持",
  accumulate: "增持",
  add: "增持",
  graduallyaccumulate: "逐步增持",
  positive: "正面",
  aboveaverage: "高于平均",
  hold: "持有",
  neutral: "中性",
  equalweight: "与大市持平",
  marketperform: "与大盘持平",
  sectorperform: "与行业持平",
  sectorweight: "与行业持平",
  peerperform: "与同业持平",
  inline: "与大盘一致",
  perform: "持平",
  average: "平均",
  mixed: "好坏参半",
  fairvalue: "估值合理",
  cautious: "谨慎",
  underperform: "跑输大盘",
  marketunderperform: "跑输大盘",
  sectorunderperform: "跑输行业",
  underweight: "减持",
  reduce: "减持",
  trim: "减仓",
  belowaverage: "低于平均",
  negative: "负面",
  moderatesell: "温和卖出",
  sell: "卖出",
  strongsell: "强烈卖出",
  notrated: "未评级",
};

/** An analyst's rating word in the reader's language. */
export function ratingWord(grade: string, lang: Lang): string {
  return lookup(RATINGS, grade, lang);
}

/**
 * Yahoo's sector of a company ("Consumer Cyclical") as the app names its sectors ("可选消费" in Chinese); Yahoo's word
 * in English, and for a sector outside the universe sectors.
 */
export function sectorName(sector: string, lang: Lang): string {
  if (lang !== "zh") return sector;
  const key = yahooSectorKey(sector);
  return (key && getSector(key)?.label.zh) || sector;
}

/** Yahoo's (Morningstar's) industries. */
const INDUSTRIES: Readonly<Record<string, string>> = {
  // Basic materials
  agriculturalinputs: "农业投入品",
  aluminum: "铝",
  buildingmaterials: "建筑材料",
  chemicals: "化工",
  cokingcoal: "焦煤",
  copper: "铜",
  gold: "黄金",
  lumberwoodproduction: "木材及木制品",
  otherindustrialmetalsmining: "其他工业金属与采矿",
  otherpreciousmetalsmining: "其他贵金属与采矿",
  paperpaperproducts: "纸及纸制品",
  silver: "白银",
  specialtychemicals: "特种化学品",
  steel: "钢铁",
  // Communication services
  advertisingagencies: "广告代理",
  broadcasting: "广播",
  electronicgamingmultimedia: "电子游戏与多媒体",
  entertainment: "娱乐",
  internetcontentinformation: "互联网内容与信息",
  publishing: "出版",
  telecomservices: "电信服务",
  // Consumer cyclical
  apparelmanufacturing: "服装制造",
  apparelretail: "服装零售",
  autotruckdealerships: "汽车与卡车经销",
  automanufacturers: "汽车制造",
  autoparts: "汽车零部件",
  departmentstores: "百货商店",
  footwearaccessories: "鞋类与配饰",
  furnishingsfixturesappliances: "家具、家装与家电",
  gambling: "博彩",
  homeimprovementretail: "家居建材零售",
  internetretail: "互联网零售",
  leisure: "休闲",
  lodging: "住宿",
  luxurygoods: "奢侈品",
  packagingcontainers: "包装与容器",
  personalservices: "个人服务",
  recreationalvehicles: "休闲车",
  residentialconstruction: "住宅建筑",
  resortscasinos: "度假村与赌场",
  restaurants: "餐饮",
  specialtyretail: "专业零售",
  textilemanufacturing: "纺织制造",
  travelservices: "旅游服务",
  // Consumer defensive
  beveragesbrewers: "饮料—啤酒",
  beveragesnonalcoholic: "饮料—无酒精",
  beverageswineriesdistilleries: "饮料—葡萄酒与烈酒",
  confectioners: "糖果",
  discountstores: "折扣店",
  educationtrainingservices: "教育培训",
  farmproducts: "农产品",
  fooddistribution: "食品分销",
  grocerystores: "超市",
  householdpersonalproducts: "家庭及个人用品",
  packagedfoods: "包装食品",
  tobacco: "烟草",
  // Energy
  oilgasdrilling: "油气钻探",
  oilgasep: "油气勘探与生产",
  oilgasequipmentservices: "油气设备与服务",
  oilgasintegrated: "综合油气",
  oilgasmidstream: "油气中游",
  oilgasrefiningmarketing: "油气炼化与销售",
  thermalcoal: "动力煤",
  uranium: "铀",
  // Financial services
  assetmanagement: "资产管理",
  banksdiversified: "银行—多元化",
  banksregional: "银行—地区性",
  capitalmarkets: "资本市场",
  creditservices: "信贷服务",
  financialconglomerates: "金融集团",
  financialdatastockexchanges: "金融数据与交易所",
  insurancebrokers: "保险经纪",
  insurancediversified: "保险—多元化",
  insurancelife: "保险—人寿",
  insurancepropertycasualty: "保险—财产与意外",
  insurancereinsurance: "保险—再保险",
  insurancespecialty: "保险—专业",
  mortgagefinance: "抵押贷款",
  shellcompanies: "空壳公司",
  // Healthcare
  biotechnology: "生物技术",
  diagnosticsresearch: "诊断与研究",
  drugmanufacturersgeneral: "制药—综合",
  drugmanufacturersspecialtygeneric: "制药—专科与仿制药",
  healthinformationservices: "医疗信息服务",
  healthcareplans: "医疗保险",
  medicalcarefacilities: "医疗机构",
  medicaldevices: "医疗器械",
  medicaldistribution: "医药分销",
  medicalinstrumentssupplies: "医疗仪器与用品",
  pharmaceuticalretailers: "药品零售",
  // Industrials
  aerospacedefense: "航空航天与国防",
  airlines: "航空公司",
  airportsairservices: "机场与航空服务",
  buildingproductsequipment: "建筑产品与设备",
  businessequipmentsupplies: "商业设备与用品",
  conglomerates: "综合企业",
  consultingservices: "咨询服务",
  electricalequipmentparts: "电气设备与零部件",
  engineeringconstruction: "工程与建筑",
  farmheavyconstructionmachinery: "农用与重型工程机械",
  industrialdistribution: "工业品分销",
  infrastructureoperations: "基础设施运营",
  integratedfreightlogistics: "综合货运与物流",
  marineshipping: "航运",
  metalfabrication: "金属加工",
  pollutiontreatmentcontrols: "污染防治",
  railroads: "铁路",
  rentalleasingservices: "租赁服务",
  securityprotectionservices: "安保服务",
  specialtybusinessservices: "专业商业服务",
  specialtyindustrialmachinery: "专用工业机械",
  staffingemploymentservices: "人力资源服务",
  toolsaccessories: "工具与配件",
  trucking: "公路货运",
  wastemanagement: "废物管理",
  // Real estate
  realestatedevelopment: "房地产—开发",
  realestatediversified: "房地产—多元化",
  realestateservices: "房地产服务",
  reitdiversified: "REIT—多元化",
  reithealthcarefacilities: "REIT—医疗设施",
  reithotelmotel: "REIT—酒店",
  reitindustrial: "REIT—工业",
  reitmortgage: "REIT—抵押贷款",
  reitoffice: "REIT—写字楼",
  reitresidential: "REIT—住宅",
  reitretail: "REIT—零售",
  reitspecialty: "REIT—特种",
  // Technology
  communicationequipment: "通信设备",
  computerhardware: "计算机硬件",
  consumerelectronics: "消费电子",
  electroniccomponents: "电子元件",
  electronicscomputerdistribution: "电子与计算机分销",
  informationtechnologyservices: "信息技术服务",
  scientifictechnicalinstruments: "科学与技术仪器",
  semiconductorequipmentmaterials: "半导体设备与材料",
  semiconductors: "半导体",
  softwareapplication: "软件—应用",
  softwareinfrastructure: "软件—基础设施",
  solar: "太阳能",
  // Utilities
  utilitiesdiversified: "公用事业—多元化",
  utilitiesindependentpowerproducers: "公用事业—独立发电商",
  utilitiesregulatedelectric: "公用事业—受监管电力",
  utilitiesregulatedgas: "公用事业—受监管燃气",
  utilitiesregulatedwater: "公用事业—受监管水务",
  utilitiesrenewable: "公用事业—可再生能源",
};

/** Yahoo's industry of a company ("Consumer Electronics") in the reader's language. */
export function industryName(industry: string, lang: Lang): string {
  return lookup(INDUSTRIES, industry, lang);
}

/** The roles Yahoo gives insiders in SEC filings. */
const ROLES: Readonly<Record<string, string>> = {
  officer: "高管",
  director: "董事",
  formerofficer: "前高管",
  formerdirector: "前董事",
  chiefexecutiveofficer: "首席执行官",
  chieffinancialofficer: "首席财务官",
  chiefoperatingofficer: "首席运营官",
  chieftechnologyofficer: "首席技术官",
  chiefaccountingofficer: "首席会计官",
  chieflegalofficer: "首席法务官",
  chiefmarketingofficer: "首席营销官",
  chiefinformationofficer: "首席信息官",
  chiefpeopleofficer: "首席人才官",
  chiefhumanresourcesofficer: "首席人力资源官",
  chiefcommercialofficer: "首席商务官",
  chiefscientificofficer: "首席科学官",
  chiefmedicalofficer: "首席医疗官",
  chiefstrategyofficer: "首席战略官",
  chiefrevenueofficer: "首席营收官",
  chiefproductofficer: "首席产品官",
  chiefinvestmentofficer: "首席投资官",
  chiefriskofficer: "首席风险官",
  chiefcomplianceofficer: "首席合规官",
  generalcounsel: "总法律顾问",
  president: "总裁",
  chairman: "董事长",
  chairmanoftheboard: "董事长",
  vicechairman: "副董事长",
  executivevicepresident: "执行副总裁",
  seniorvicepresident: "高级副总裁",
  vicepresident: "副总裁",
  secretary: "公司秘书",
  corporatesecretary: "公司秘书",
  treasurer: "财务主管",
  controller: "财务总监",
  beneficialowner: "实益股东",
  beneficialowner10ormore: "持股 10% 以上的股东",
  beneficialownerofmorethan10ofaclassofsecurity: "持股 10% 以上的股东",
};

/** An insider's role ("Officer and Director") in the reader's language; a combination of known roles joins with 兼. */
export function insiderRole(role: string, lang: Lang): string {
  if (lang !== "zh") return role;
  const whole = ROLES[keyOf(role)];
  if (whole) return whole;
  const parts = role.split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean);
  const translated = parts.map((part) => ROLES[keyOf(part)]);
  return parts.length > 1 && translated.every(Boolean) ? translated.join("兼") : role;
}

/** Yahoo's quote types, as search results label them. */
const QUOTE_TYPES: Readonly<Record<string, string>> = {
  equity: "股票",
  etf: "ETF",
  mutualfund: "共同基金",
  moneymarket: "货币市场基金",
  index: "指数",
  future: "期货",
  currency: "外汇",
  cryptocurrency: "加密货币",
  option: "期权",
};

/** A quote type ("EQUITY", "FUTURE") in the reader's language. */
export function quoteTypeName(type: string, lang: Lang): string {
  return lookup(QUOTE_TYPES, type, lang);
}
