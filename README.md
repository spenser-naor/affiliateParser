# Affiliate Parser

DESCRIPTION
This is a tool I built for scraping and sorting affiliate marketing deals into MongoDB. My database was structured by the Parse Platform. This was part of a larger project which took these product deals and populated an in-app market place on iOS. I've stripped out the platform specific calls, but much of the hard-coding still remains. Nevertheless, this structure could be used to accomplish a similar goal using any product source which returns JSON.
What's cool here is that I would pull the raw data for each deal, strip out what I needed, run some custom sorting and categorization functions, and structure the data such that my mobile app could populate a custom designed product page:
![image](https://user-images.githubusercontent.com/24867725/122938949-0884b700-d328-11eb-8b85-05a7abf26fd2.png)

WHAT I LEARNED
Simple as it may seem, this was a fun exercise in re-purposing data for an unintended us. Most affiliate marketing platforms expect you to provide your followers with a simple referral code, or embed their pre-built banners into your site. Instead, I disassembled the affiliate deals, and then re-assembled to fit my own specifications. With a sprinkling of 
