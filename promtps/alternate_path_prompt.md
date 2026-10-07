okay. now we are going with a different approach. what we currently have is the price from clover and sale price in zkong in sync in both ways . verify again if it is implemented correctly. it was working fine before we implemented the reprising list . im not saying that it is not working now. i just want you to verify once aagin. 

now the different approach . in zkong we have
1. Was
2. Discount %
3. Discount Number
4. Promotion Start
5. Promotion End
6. Sale Price

going forward we will not have UI in the middleware
since we already have bidirectional sync, we have two scenarios,
1.change in clover that needs to be changed zkong
2.change zkong that needs to be changed in clover

scenraio 1 is straight forward. any change in clover will update the zkong sale price. that is how it has been so far now. verify if im wrong.

scenraio 2 is when we have to sync change from zkong to clover. 
    so lets say the user has updated the field "Discount %" in zkong. so when polling we will see this change in our middleware. once we a discount % value, we should calculate the new price (current clover price - discount % from zkong) update this to clover. but this change will create a webhook trigger to our middleware, which automatically update the sale price in zkong. but the sale price in zkong should not be updated when there is a discount% value is there in zkong

    the similar way for discount number. instead of calcuating the new price (clover price - discount %) , new price itself is giving in the discount number.


clarifications

Clarifying Questions and answers
Discount % in poll response? The erp/item/list response only returns price (effective sale price) and originalPrice (base price). It does NOT return discount or discountCalculationField — those are only in batchImportItem request. So when polling, we only see the computed sale price. Is this correct understanding?

okay. why dont we use the batchImportItem then?

"Discount Number" = repricingList.price or price? You said "new price itself is given in the discount number" — this sounds like the promotional price in repricingList. But erp/item/list doesn't return repricingList. Do we need to also poll strategy/list or strategy/get/{id} to get active promo details?

yes. poll to get active promo details

What is the "base price" in Clover?
Clover has one price field (cents)
You want: Clover price = base price (Was) normally; Clover price = sale price during promo
Where do we store the "Was" (originalPrice) so we can restore it when promo ends? Currently item_map only has standard_price and last_pushed_price.

we dont have to care about "Was" we do not have to store it. it will only be for ESL display purpose.

Echo suppression logic for Scenario 2: You said "sale price in zkong should not be updated when there is a discount% value". But we only poll price (sale price). How do we know if a discount is active vs. a base price change? Compare price vs originalPrice in poll response?

Compare price vs originalPrice in poll response

Promotion window handling: Should we also sync proStartTime/proEndTime to Clover? Clover has no scheduling — we'd just push the sale price during the window and revert when it ends. Is that the intent?

yes

unitName consistency: Current code sends unitName: 0 (cents/100). Poll response price appears to be decimal (e.g., 11.11). zkongPriceToCents handles both. Should we switch to unitName: 1 (decimal) to match? Or keep 0 and ensure parsing is correct?

understand one thing, anything from zkong will be cents. anything from clover will be in regular dollars with decimal. convert them accordingly

Please clarify these, especially #1, #3, #4.