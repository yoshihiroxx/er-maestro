-- PostgreSQL — orders (references users + products across files)
CREATE TABLE orders (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users (id),
    status      TEXT NOT NULL DEFAULT 'pending',
    placed_at   TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products (id),
    quantity    INTEGER NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL
);

CREATE TABLE payments (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders (id),
    amount_cents INTEGER NOT NULL,
    provider    TEXT NOT NULL
);

-- FK declared via ALTER (pg_dump style) to exercise that path
ALTER TABLE orders ADD CONSTRAINT fk_orders_session
    FOREIGN KEY (user_id) REFERENCES users (id);
