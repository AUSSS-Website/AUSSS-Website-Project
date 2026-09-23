// AUSSS 2025–26 merch catalogue. Every product is a pre-order: per the
// booklet, "all orders are on a pre-order basis, so no expenses or incomes are
// held by AUSSS. What you pay for is what you get."
//
// Fields:
//   id           stable slug, used as the React key and the cart key
//   name         display name
//   tagline      short line from the booklet (optional)
//   description  paragraph for the product card
//   image        product shot (currently a booklet page)
//   price        EGP
//   sizes        available sizes, in order (clothing only)
//   sizeChart    size-chart image (optional)
//   designs      design / committee variants, in order
//   wideDesigns  designs that take a full-width row in the picker (optional)
//   available    false hides the product from the shop

const merchProducts = [
  {
    id: 'tshirt-55',
    name: 'AUSSS T-Shirt, 55th Limited Edition',
    tagline: 'Think Global. Act Local.',
    description:
      'Forest-green ringer tee with white trim. AUSSS shield embroidered on the chest, alligator monogram on the side, and the "Life Savers, Change Makers" script on the back, finished with "55 years of youth, 55 years of impact."',
    image: '/assets/merch/page-04.jpg',
    price: 300,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    sizeChart: '/assets/merch/size-chart-tshirt.jpg',
    designs: [],
    available: true,
  },
  {
    id: 'jacket',
    name: '"The" AUSSS Jacket',
    tagline: 'Same vibe. Same legacy.',
    description:
      'The varsity jacket is back. Forest-green body with cream wool-blend sleeves, AUSSS shield on the chest, "Life Savers, Change Makers" embroidered on the back, "25/26" and the AUSSS-Earth crest on the left sleeve, the AUSSS alligator on the right.',
    image: '/assets/merch/page-11.jpg',
    price: 650,
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    sizeChart: '/assets/merch/size-chart-jacket.jpg',
    designs: [],
    available: true,
  },
  {
    id: 'bucket-hat',
    name: 'Dash Bucket Hat',
    tagline: 'When things get too hot.',
    description:
      'Cream cotton bucket hat with the green AUSSS alligator embroidered on the front.',
    image: '/assets/merch/page-12.jpg',
    price: 150,
    sizes: ['One size'],
    designs: [],
    available: true,
  },
  {
    id: 'notebook',
    name: 'AUSSS Notebook',
    tagline: 'Like it? Note it down.',
    description:
      'Spiral-bound notebook with a committee-themed cover. Pick a standing committee, the Exchange (SCOPE + SCORE) cover, or the Support Divisions cover.',
    image: '/assets/merch/page-13.jpg',
    price: 40,
    sizes: [],
    designs: ['SCOPH', 'SCORA', 'SCOME', 'SCORP', 'Exchange', 'Support Divisions'],
    wideDesigns: ['Exchange', 'Support Divisions'],
    available: true,
  },
]

// Lookups used by the cart and the checkout.
export const productById = Object.fromEntries(merchProducts.map((p) => [p.id, p]))

export const availableProducts = merchProducts.filter((p) => p.available)
