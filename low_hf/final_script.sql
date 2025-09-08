WITH prices AS (
  SELECT
      cm.address AS credit_manager,
      cm.underlying_token AS underlying_token,
      tcp.price  AS price,
      cm.pool_address AS pool_address
  FROM credit_managers cm
  JOIN token_current_price tcp
    ON tcp.token = cm.underlying_token
  JOIN pools p
    ON cm.pool_address = p.address
   AND tcp.price_oracle = p.price_oracle
  WHERE tcp.price_source = 'gearbox'
),

latest_pool_stats AS (
  SELECT
      z.pool,
      z.block_num AS ps_block_num,
      z.base_borrow_apy,       
      z.available_liquidity      
  FROM (
      SELECT
          ps.*,
          ROW_NUMBER() OVER (PARTITION BY ps.pool ORDER BY ps.block_num DESC) AS rn
      FROM pool_stats ps
  ) z
  WHERE z.rn = 1
) 
SELECT
  cs.id AS session_id,
  cs.account,
  cs.credit_manager,
  b1.timestamp AS since_timestamp,
  b2.timestamp AS closed_at_timestamp,

  (cd.cal_health_factor)::float8 AS cal_health_factor_scaled,
  ((cd.cal_health_factor)::numeric / 10000::numeric) AS cal_health_factor_raw,
  cd.cal_borrowed_amt_with_interest AS cal_borrowed_amt_with_interest,
  (cd.cal_borrowed_amt_with_interest * prices.price) AS borrowed_amt_with_interest_usd,
  cd.cal_total_value AS cal_total_value,
  cd.total_value_usd AS total_value_usd,
  cd.tf_index,

  CASE
    WHEN (cd.cal_total_value - cd.cal_borrowed_amt_with_interest) = 0
      THEN 0
    ELSE ((cd.cal_total_value / (cd.cal_total_value - cd.cal_borrowed_amt_with_interest)) * 100)::integer
  END  AS leverage,

  prices.underlying_token,
  prices.price AS underlying_price_usd,
  prices.pool_address,

  lps.base_borrow_apy,                          
  lps.available_liquidity AS available_liquidity_underlying,
  (lps.available_liquidity * prices.price) AS available_liquidity_usd

FROM credit_sessions cs
JOIN current_debts cd
  ON cd.session_id = cs.id
JOIN prices
  ON prices.credit_manager = cs.credit_manager
LEFT JOIN blocks b1
  ON cs.since = b1.id
LEFT JOIN blocks b2
  ON cs.closed_at = b2.id
LEFT JOIN latest_pool_stats lps
  ON lps.pool = prices.pool_address

WHERE
  (cd.cal_health_factor)::float4 >= 0
  AND (cd.cal_health_factor)::float4 <= 11000
  AND cs.version IN ('300')
  AND cs.status  IN ('0')

ORDER BY cs.status ASC, total_value_usd DESC;