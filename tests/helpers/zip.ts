import { deflateRawSync } from "node:zlib";
export function testZip(
  files: Record<string, Buffer | string>,
  compress = false,
): Buffer {
  const entries: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const plain = typeof value === "string" ? Buffer.from(value) : value;
    const payload = compress ? deflateRawSync(plain) : plain;
    const filename = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of plain) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(compress ? 8 : 0, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(plain.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(compress ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    entries.push(header, filename, payload);
    directory.push(central, filename);
    offset += header.length + filename.length + payload.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, central, end]);
}
export const tandoorFixture = {
  name: "Kartoffelpfanne",
  description: "Einfach",
  servings: 4,
  servings_text: "",
  working_time: 10,
  waiting_time: 15,
  internal: true,
  source_url: "https://example.test/recipe",
  keywords: [
    {
      name: "Schnell",
      description: "",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
  ],
  steps: [
    {
      name: "Pfanne",
      instruction: "Kartoffeln garen.",
      time: 3,
      order: 0,
      show_as_header: true,
      show_ingredients_table: true,
      ingredients: [
        {
          food: {
            name: "Kartoffeln",
            plural_name: "",
            ignore_shopping: false,
            supermarket_category: null,
          },
          unit: { name: "g", plural_name: "", description: "" },
          amount: "500.00000",
          note: "",
          order: 0,
          is_header: false,
          no_amount: false,
        },
      ],
    },
  ],
  nutrition: {
    id: 12,
    calories: "350.00",
    carbohydrates: "20.00",
    fats: "10.00",
    proteins: "5.00",
    source: "Export",
  },
};
