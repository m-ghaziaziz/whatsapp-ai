const { initSchema, Products } = require('./index');

async function seed() {
  await initSchema();
  
  // Clear old products to allow fresh seeding
  const existing = await Products.getAll();
  for (const item of existing) {
    await Products.delete(item.id);
  }

  console.log('Seeding initial products organized by categories with variations...');

  const initialProducts = [
    // PIZZAS
    {
      name: 'Artisanal Woodfired Pizza',
      category: 'Pizzas',
      description: 'Handcrafted pizza made with imported Italian flour, fresh mozzarella, and slow-simmered tomato sauce.',
      base_price: 12.99,
      variations: [
        {
          group: 'Size',
          options: [
            { name: 'Medium (10")', priceDelta: 0 },
            { name: 'Large (14")', priceDelta: 4.50 },
            { name: 'Family (18")', priceDelta: 8.00 }
          ]
        },
        {
          group: 'Crust',
          options: [
            { name: 'Classic Thin Crust', priceDelta: 0 },
            { name: 'Stuffed Cheese Crust', priceDelta: 2.50 },
            { name: 'Gluten-Free Crust', priceDelta: 3.00 }
          ]
        },
        {
          group: 'Flavor',
          options: [
            { name: 'Margherita Special', priceDelta: 0 },
            { name: 'Pepperoni Supreme', priceDelta: 2.00 },
            { name: 'BBQ Smoked Chicken', priceDelta: 2.50 },
            { name: 'Truffle Mushroom (Veg)', priceDelta: 3.00 }
          ]
        }
      ]
    },
    {
      name: 'Spicy Pepperoni & Hot Honey Pizza',
      category: 'Pizzas',
      description: 'Loaded with double crispy pepperoni slices, chili flakes, mozzarella, and a drizzle of hot organic honey.',
      base_price: 14.99,
      variations: [
        {
          group: 'Size',
          options: [
            { name: 'Medium (10")', priceDelta: 0 },
            { name: 'Large (14")', priceDelta: 5.00 }
          ]
        },
        {
          group: 'Crust',
          options: [
            { name: 'Classic Crust', priceDelta: 0 },
            { name: 'Garlic Butter Crust', priceDelta: 1.50 }
          ]
        }
      ]
    },

    // BURGERS
    {
      name: 'Gourmet Angus Smash Burger',
      category: 'Burgers',
      description: 'Double Angus beef patty smashed with caramelized onions, aged cheddar, and house secret sauce on a toasted brioche bun.',
      base_price: 9.99,
      variations: [
        {
          group: 'Patty Count',
          options: [
            { name: 'Double Patty', priceDelta: 0 },
            { name: 'Triple Patty Monster', priceDelta: 3.50 },
            { name: 'Beyond Meat (Plant-Based)', priceDelta: 2.00 }
          ]
        },
        {
          group: 'Combo Meal',
          options: [
            { name: 'Burger Only', priceDelta: 0 },
            { name: 'With Crispy Fries & Soda', priceDelta: 3.99 },
            { name: 'With Loaded Bacon Cheese Fries & Milkshake', priceDelta: 5.99 }
          ]
        }
      ]
    },
    {
      name: 'Crispy Honey Mustard Chicken Burger',
      category: 'Burgers',
      description: 'Extra crispy buttermilk fried chicken breast, tangy honey mustard glaze, pickles, and purple slaw on brioche.',
      base_price: 8.99,
      variations: [
        {
          group: 'Spice Level',
          options: [
            { name: 'Mild', priceDelta: 0 },
            { name: 'Spicy Nashville Hot', priceDelta: 0.50 }
          ]
        }
      ]
    },

    // STARTERS
    {
      name: 'Korean Fried Chicken Wings',
      category: 'Starters',
      description: 'Double-fried extra crunchy chicken wings tossed in your choice of delicious gourmet glazes.',
      base_price: 8.49,
      variations: [
        {
          group: 'Portion',
          options: [
            { name: '6 Wings', priceDelta: 0 },
            { name: '12 Wings', priceDelta: 6.00 },
            { name: '18 Wings Party Bucket', priceDelta: 11.00 }
          ]
        },
        {
          group: 'Sauce Glaze',
          options: [
            { name: 'Sweet Soy Garlic', priceDelta: 0 },
            { name: 'Honey Butter', priceDelta: 0 },
            { name: 'Fiery Spicy Gochujang', priceDelta: 0.50 }
          ]
        }
      ]
    },
    {
      name: 'Loaded Melted Cheese Fries',
      category: 'Starters',
      description: 'Golden skin-on fries smothered in hot cheddar cheese sauce, crispy bacon bits, jalapeños, and ranch drizzle.',
      base_price: 6.99,
      variations: [
        {
          group: 'Topping Add-on',
          options: [
            { name: 'Classic Loaded', priceDelta: 0 },
            { name: 'With Pulled Beef BBQ', priceDelta: 2.50 }
          ]
        }
      ]
    },

    // PASTAS
    {
      name: 'Creamy Truffle Fettuccine Alfredo',
      category: 'Pastas',
      description: 'Al dente fettuccine tossed in rich garlic parmesan cream sauce infused with white truffle oil and fresh parsley.',
      base_price: 11.99,
      variations: [
        {
          group: 'Protein Choice',
          options: [
            { name: 'Vegetarian (Mushroom)', priceDelta: 0 },
            { name: 'Grilled Chicken Breast', priceDelta: 3.00 },
            { name: 'Garlic Butter Shrimp', priceDelta: 4.50 }
          ]
        }
      ]
    },

    // DRINKS
    {
      name: 'Artisanal Specialty Drinks',
      category: 'Drinks',
      description: 'Cold & refreshing hand-crafted beverages.',
      base_price: 3.50,
      variations: [
        {
          group: 'Flavor',
          options: [
            { name: 'Iced Peach Passionfruit Tea', priceDelta: 0 },
            { name: 'Fresh Mint & Lime Lemonade', priceDelta: 0 },
            { name: 'Belgian Chocolate Thick Shake', priceDelta: 2.00 },
            { name: 'Salted Caramel Cookie Shake', priceDelta: 2.00 }
          ]
        }
      ]
    },

    // DESSERTS
    {
      name: 'Warm Chocolate Molten Lava Cake',
      category: 'Desserts',
      description: 'Decadent chocolate cake with a molten chocolate center, served warm with vanilla bean ice cream.',
      base_price: 5.99,
      variations: [
        {
          group: 'Ice Cream Scoop',
          options: [
            { name: 'Vanilla Bean Scoop', priceDelta: 0 },
            { name: 'Double Scoop Vanilla & Caramel', priceDelta: 1.50 }
          ]
        }
      ]
    }
  ];

  for (const item of initialProducts) {
    await Products.create(item);
  }

  console.log('Seed completed successfully with categories!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
