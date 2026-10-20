// Published catalog shared by storefront and server. Prices are THB.
(function(root) {
  const retail = [
  {
    "sku": "raptor-cool-patch",
    "name": "RAPTOR COOL PATCH",
    "price": 179
  },
  {
    "sku": "raptor-cooling-spray",
    "name": "RAPTOR SPORTS ICE COLD SPRAY",
    "price": 179
  },
  {
    "sku": "raptor-dual-action-pack",
    "name": "RAPTOR DUAL ACTION PACK",
    "price": 329
  },
  {
    "sku": "raptor-go-energy-gel",
    "name": "RAPTOR GO ENERGY GEL",
    "price": 79
  },
  {
    "sku": "raptor-herbal-cooling-gel",
    "name": "RAPTOR HERBAL COOLING GEL",
    "price": 189
  },
  {
    "sku": "raptor-herbal-roll-on",
    "name": "RAPTOR HERBAL ROLL-ON",
    "price": 179
  },
  {
    "sku": "raptor-ice-defense-sport-shampoo",
    "name": "RAPTOR ICE DEFENSE SPORT SHAMPOO",
    "price": 199
  },
  {
    "sku": "raptor-sport-foot-spray",
    "name": "RAPTOR SPORT FOOT SPRAY",
    "price": 179
  },
  {
    "sku": "raptor-sport-therapy-oil",
    "name": "RAPTOR SPORT & THERAPY OIL",
    "price": 179
  },
  {
    "sku": "raptor-v-mix",
    "name": "RAPTOR V-MIX เครื่องดื่ม วิตามิน เกลือแร่ อิเล็กโทรไลท์",
    "price": 490
  },
  {
    "sku": "raptor-warming-spray",
    "name": "RAPTOR ELITE PRO สเปรย์สำหรับนักกีฬา สเปรย์สูตรวอร์มอัพ 250ml",
    "price": 179
  }
];
  const wholesale = [
            {id:'p1',name:'สเปรย์เย็น (Raptor Sport Cooling Spray)',detail:'ขนาด 250ml / สูตรน้ำแข็งดับเบิ้ลคูล สำหรับนักกีฬา',image:'../raptor-sport-cooling-spray.png',defaultPrice:100,tiers:[{min:50,price:95},{min:100,price:85},{min:1000,price:75},{min:10000,price:65}]},
            {id:'p2',name:'RAPTOR ELITE PRO สเปรย์สูตรวอร์มอัพ',detail:'ขนาด 250ml / วอร์มกล้ามเนื้อก่อนและหลังกีฬา คลายปวด',image:'../raptor-elite-pro-warming-spray-250ml.png',defaultPrice:100,tiers:[{min:50,price:95},{min:100,price:85},{min:1000,price:75},{min:10000,price:65}]},
            {id:'p3',name:'น้ำมันนวดหัวลูกกลิ้ง (Raptor Herbal Roll-On)',detail:'ขนาด 10ml / หัวลูกกลิ้งสแตนเลส สารสกัดธรรมชาติ',image:'../raptor-herbal-roll-on.png',defaultPrice:75,tiers:[{min:50,price:71},{min:100,price:68},{min:1000,price:66},{min:10000,price:65}]},
            {id:'p4',name:'แผ่นแปะเย็นประคบ (Raptor Cool Patch)',detail:'บรรจุ 6 แผ่น/กล่อง | ขนาด 7x10 cm แอดวานซ์เมนทอล',image:'../raptor-cool-patch.png',defaultPrice:98,tiers:[{min:50,price:93},{min:100,price:90},{min:1000,price:88},{min:10000,price:86}]},
            {id:'p5',name:'เจลให้พลังงานทันที (Raptor Go Energy Gel)',detail:'รสโคล่า บรรจุ 10 ซอง/กล่องใหญ่ ให้พลังงาน 120 kcal',image:'../raptor-go-energy-gel.png',defaultPrice:280,tiers:[{min:50,price:255},{min:100,price:235},{min:1000,price:210},{min:10000,price:190}]},
            {id:'p6',name:'RAPTOR V-MIX เครื่องดื่ม วิตามิน เกลือแร่ อิเล็กโทรไลท์',detail:'กลิ่นแตงโม วิตามิน B1/B6/B12 | บรรจุ 6g x 20 ซอง',image:'../raptor-v-mix-electrolyte-drink.png',defaultPrice:300,tiers:[{min:50,price:275},{min:100,price:260},{min:1000,price:230},{min:10000,price:220}]},
            {id:'p7',name:'น้ำมันนวดสำหรับนักกีฬา (RAPTOR Sport & Therapy Oil)',detail:'ขนาด 100ml / นวดคลายกล้ามเนื้อ ซึมไวไม่เหนียวเหนอะหนะ',image:'../raptor-sport-therapy-oil.png',defaultPrice:100,tiers:[{min:50,price:95},{min:100,price:85},{min:1000,price:75},{min:10000,price:65}]},
            {id:'p8',name:'เจลสมุนไพรสูตรเย็น (RAPTOR Herbal Cooling Gel)',detail:'ขนาด 100g / เนื้อเจลซึมไว บรรเทาอาการปวดเมื่อย',image:'../raptor-herbal-cooling-gel.png',defaultPrice:170,tiers:[{min:50,price:155},{min:100,price:140},{min:1000,price:125},{min:10000,price:110}]},
            {id:'p9',name:'สเปรย์ฉีดเท้าลดกลิ่นอับ (RAPTOR Sport Foot Spray)',detail:'ขนาด 100ml / ลดกลิ่นอับ ช่วยคืนความเย็นสดชื่น',image:'../raptor-sport-foot-spray.png',defaultPrice:100,tiers:[{min:50,price:95},{min:100,price:85},{min:1000,price:75},{min:10000,price:65}]},
            {id:'p10',name:'แชมพูสูตรเย็นสำหรับนักกีฬา (RAPTOR Ice Defense Sport Shampoo)',detail:'ขนาด 500ml / ขจัดคราบเหงื่อไคล เย็นสดชื่นหลังเล่นกีฬา',image:'../raptor-ice-defense-sport-shampoo.png',defaultPrice:120,tiers:[{min:50,price:110},{min:100,price:99},{min:1000,price:89},{min:10000,price:79}]}
        ];
  const catalog = { retail, wholesale };
  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  else root.RaptorCatalog = catalog;
}(typeof window !== 'undefined' ? window : globalThis));
