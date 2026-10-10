we will diverting to a new path of our application which will introduce UI to onboard a user. let the UI be on react typescript vite and tailwind css

the user will represent a business. ideally a grocery store or a super market.

the user could have any POS for his business. can be Square, Toast, Clover, or Lightspeed. so, the idea is the user should be able to bring any pos software that can be integrated to their zkong application.

so the .env of our application should contain only these values. all other configurations should be in db tables, which will be dynamically set by the user and read by our middleware.
---.env file start---
PORT=
ZKONG_POLL_INTERVAL_MS=
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
DATABASE_URL=
---.env file end---

lets not care about other POS, let just care about Clover for now.

we will need a new db table called "integrations". this db table to keep track the user of certain email and business name, opted which POS system. this record will also hold the configuration details for the POS and zkong. the columns for this integrations be
---start of table structure---
1. ID (primary key)
2. integrationId - (random and unique UUID for this integration. this will be used by external application to refer this integration)
3. registeringBusinessName
4. registeringBusinessEmail
5. selectedPos (can be any of Square, Toast, Clover, or Lightspeed)
6. posConfiguration
7. zkongConfiguration
8. status (status can have the following numeric keys as value which should be interpreted to the values)
     0 - PENDING SETUP
     1 - CONFIG VERIFIED
     2 - PAUSED
     3 - LIVE
     -1 - DELETED
9. createdAt
10. updatedAt
---end of table structure---

also by current implementation we had a generic webhook url https://clokong.fullform.one/webhooks/clover . but from now on, we will have the webhook like https://clokong.fullform.one/webhooks/<dynamic-value>. the dynamic value is simply the integrationId in the above table. so that when this webhook call is received, by looking at the table we will be able make decision on which pos to target and which zkong to target.

so the process of on boarding will look like this. let the url be /onboarding

the onboarding page will have a stepper like view.
step 1:
    1. get business name
    2. get business email

step 2:
    give option to select from available POS optiions. display the options Square, Toast, Clover, or Lightspeed. let clover be only enabled option for now. 
   
after selecting, and when the user clicks next, make an api call to the backend (create this api in backend). this api should create a record in integrations table. lets call this DB as integrations. populate the user entered business name, business email, selected pos and an auto generated integration from the UI to the table using the api. the response of this api should be the integrationId. this integrationId will be used in the later steps to make api calls from the UI for onboarding.

step 3:
    get the selected POS environment details (in our case the default available option will be clover). the POS environment details for clover are 
    CLOVER_API_BASE= (let https://sandbox.dev.clover.com/v3/merchants be the default value for this clover configuration. can be changed by the user) (strip the trailing slash if the user adds it in this input)
    CLOVER_MERCHANT_ID= 
    CLOVER_CLIENT_APP_ID=
    CLOVER_API_TOKEN=
    CLOVER_AUTH_CODE= (immutable field just to display . also have a refresh button next to the input, to get the latest config value from the db.)

    ask these values from the user. let the labels be not exacly the same. use realistic label names.
    the clover auth code is received when a the clover sandbox applicaton makes a test webhook call to the url that is generated in the step 2. so display that webhook url and ask the user to give this url as webhook url to the clover sandbox application and initiate a test. this should automatically make a webhook call with an authcode, and this auth code should be saved in the db under the column posConfiguration in a json object in a field called cloverAuthToken. after that ask the user to refresh the clover auth code to get it from db. now with auth code from webhoook available, ask the user to copy this authcode from our application and to paste this the clover sandbox application.

    the above details mentioned in step 3 is just for clover pos. config flow for other pos might differ and we dont know anything about them yet. do not make any assumptions. ask me any question if any.

step 4:
    get the zkong environmetn details.
    ZKONG_ACCOUNT=VensweGlobalLLC
    ZKONG_PASSWORD=zkong@123
    ZKONG_MERCHANT_ID=1786427294219 
    ZKONG_AGENCY_ID=1558577702698
    ZKONG_STORE_ID=1607566698661

    we had some trouble finding this values. for each field, have a tooltip or a information popover on how to find them 

step 5: this is the main step 