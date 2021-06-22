//Declarations
var Parse = require('parse/node');
var request = require('request').defaults({ encoding: null });
var MongoClient = require('mongodb').MongoClient;
var Grid = require('mongodb').GridFSBucket;
var Chunk = require('mongodb').Chunk;
var S3Adapter = require('parse-server').S3Adapter;
var s3Adapter = new S3Adapter(
	"ACCESSKEY_ID",
	"SECRET_KEY",
	"BUCKET",
	{ directAccess: true }
	);


//----- Parse init -----
Parse.initialize("YOUR_APP_ID", "YOUR_JAVASCRIPT_KEY");
Parse.serverURL = 'YOUR_SERVER_URL';

var oldProducts=[]; // holds names of all products at load time. No new items with the same name will be created
var newProducts=[]; // this is used to prevent exact duplicate products. The need for this is much rarer than the correction for sizing implemented in BrandA refresh, but it still happens form time to time

var toDelete=[]; //initially filled in loadItems, and gradually culled as duplicates are found among merchant requests. Eventually will delete items which merchants no longer offer/are not getting pulled in our requests.
var toDeleteNames=[]; //helper array with only the names of items to be deleted, matching the indices of toDelete


//----- Database Refresh Functions -----
function refreshBrandA(){
	return new Promise(function(resolve, reject) {
		console.log('refreshing BrandA...');
		//The first of these three "refresh" functions needs to include my credentials.
		//As long as this is called each run, the other functions do not need these credentials
		var options = {
			url: 'API_URL',
			headers: {
				'Accept': 'application/json',
				'apiKey': 'API_KEY'
			}
		};

		function callback(error, response, body) {
			if (!error && response.statusCode == 200) {
				var results = JSON.parse(body); //In my case, this returns a JSON which needs to be parsed, the rest of this function is handling that raw data
				var products = results["results"];

				//cull products to prevent repeats
				var culledProducts = []; //new array of products without repeats
				var usedNames = []; //array of names already used
				for (var i = 0; i < products.length; i++) {
					var product = products[i];
					var productName = product["name"].split(" Size ")[0];
					if (!usedNames.includes(productName)){
						usedNames.push(productName);
						culledProducts.push(product);

						//check if product already exists in market. if so, remove from delete list, if not, create
						var deleteIndex = toDeleteNames.indexOf(productName);
						if(deleteIndex>=0){
							toDeleteNames.splice(deleteIndex,1);
							toDelete.splice(deleteIndex,1);
							//console.log("removing "+productName+" from delete list");
							culledProducts.splice(product);
						}
					}
				}

				console.log('Number of Products from BrandA: ' culledProducts.length);
				resolve('BrandA resolved with toDelete count: '+toDelete.length); //resolve promise after toDelete is updated

				//increment through returns to create product PFObjects
				for (var i = 0; i < culledProducts.length; i++) {
					var product = culledProducts[i];

					var savings = round((Number(product["discount"])/Number(product["price"]))*100,2);

					if(savings>=25 && newProducts.indexOf(product["name"])<0 && oldProducts.indexOf(product["name"])<0){ //this culls out unwanted items

						newProducts.push(product["name"]);

						var newItem = Parse.Object.extend("Item");

						var item = new newItem();

						item.set("dealType", "product"); //dealtype can be service as well.
						item.set("seller", product["brand"]);
						item.set("description", product["name"].split(" Size ")[0]);//makes sure name excludes sizing info
						item.set("detailTitle", product["name"].split(" Size ")[0])//makes sure name excludes sizing info;
						item.set("detailDescription", product["description"]);
						item.set("price", Number(product["salePrice"]));
						item.set("priceOrig", Number(product["price"]));
						item.set("savePercent", savings);
						item.set("buyURL", product["linkUrl"]);
						item.set("category", category(product,'MyCategory'));
						item.set("badges", findLevel(product["price"],product["salePrice"])); //needs to create some logic for determining badge requirements
						item.set("location", "National");

						console.log('Product Level for ' + product["name"] + ': ' +findLevel(product["price"],product["salePrice"]));

						var imageUrl = product["imageUrl"];
						imageUrl = imageUrl.replace(/1000/g, '500');//response defaults to large photo, this scales it a little
						imageRequest(imageUrl, item); //need to scope out the next request otherwise product saving doesn't work properly
					}
				}
			}
			else{
				console.log('error: '+error);
				reject('BrandA rejected: '+error);
			}
		}
	request(options, callback);
	});
}

function refreshBrandB(){
	//This query allows for arguments to refine the product search
	if (arguments.length<2){
		throw ('Please provide a Search Term and a Sale Percent value to "refreshBrandB"')
	}
	var searchTerm = arguments[0]
	var salePercent = arguments[1]

	return new Promise(function(resolve, reject) {
		console.log('refreshing BrandB.com with query: '+searchTerm+'...');
		var options = 'BRANDB_DATA_SOURCE'+searchTerm
		function callback(error, response, body) {

			if(error){
				console.log('error:', error); // Print the error if one occurred
				reject('BrandB '+ searchTerm +' rejected with error: '+ error);
			}
			
			var result = JSON.parse(body);

			//cull products to prevent repeats
			var culledProducts = []; //new array of products without repeats
			var usedNames = []; //array of names already used
			for (var i = 0; i < result.length; i++) {
				var product = result[i];
				var productName = product["strProductName"];
				if (!usedNames.includes(productName)){
					usedNames.push(productName);
					culledProducts.push(product);

					//check if product already exists in market. if so, remove from delete list, if not, create
					var deleteIndex = toDeleteNames.indexOf(productName);
					if(deleteIndex>=0){
						toDeleteNames.splice(deleteIndex,1);
						toDelete.splice(deleteIndex,1);
						//console.log("removing "+productName+" from delete list");
						culledProducts.splice(product);
					}
				}
			}
			resolve('BrandB '+ searchTerm +' resolved with toDelete count: '+ toDelete.length); //resolve promise after toDelete is updated
		
			for (var i = 0; i < culledProducts.length; i++) {

				var firstProduct = culledProducts[i];

				if(newProducts.indexOf(firstProduct["strProductName"])<0 && oldProducts.indexOf(product["strProductName"])<0){
					newProducts.push(firstProduct["strProductName"]);
			
					//console.log(firstProduct["strProductName"]);
					var newItem = Parse.Object.extend("Item");
			
					var item = new newItem();
					item.set("dealType", "product"); //dealtype can be service as well.
					item.set("price", Number(firstProduct["dblProductSalePrice"]));
					item.set("priceOrig", Number(firstProduct["dblProductPrice"]));
					item.set("savePercent", round(Number(firstProduct["dblProductOnSalePercent"]),2));
					item.set("detailDescription", firstProduct["txtLongDescription"]);
					item.set("description", firstProduct["strProductName"]);
					item.set("detailTitle", firstProduct["strProductName"]); // needs logic to have a snappy call to action for each item
					item.set("seller", firstProduct["strBrandName"]);
					item.set("name", firstProduct["strProductSKU"]);
					item.set("location", "National");
					item.set("badges", findLevel(firstProduct["dblProductPrice"],firstProduct["dblProductSalePrice"])); //needs to create some logic for determining badge requirements
					item.set("buyURL", firstProduct["strBuyURL"]);
					item.set("category",);
			
					console.log('Product Level for ' + firstProduct["strProductName"] + ': ' + findLevel(firstProduct["dblProductPrice"],firstProduct["dblProductSalePrice"]));
					
					imageRequest(firstProduct["strLargeImage"], item); //need to scope out the next request otherwise product saving doesn't work properly	
				}
			}
		};
		request(options, callback);
	});
};

function refreshBrandC(){
	return new Promise(function(resolve, reject) {
		console.log('refreshing BrandC...');
		var options = 'BRANDC_DATA_SOURCE'
		function callback(error, response, body) {

			if(error){
				console.log('error:', error); // Print the error if one occurred
				reject('BrandC rejected:', error);
			}
			var result = JSON.parse(body);  //In my case, this returns a JSON which needs to be parsed, the rest of this function is handling that raw data

			//cull products to prevent repeats
			var culledProducts = []; //new array of products without repeats
			var usedNames = []; //array of names already used
			for (var i = 0; i < result.length; i++) {
				var product = result[i];
				var productName = product["strProductName"];
				if (!usedNames.includes(productName)){
					usedNames.push(productName);
					culledProducts.push(product);
					//check if product already exists in market. if so, remove from delete list, if not, create
					var deleteIndex = toDeleteNames.indexOf(productName);
					if(deleteIndex>=0){
						toDeleteNames.splice(deleteIndex,1);
						toDelete.splice(deleteIndex,1);
						console.log("removing "+productName+" from delete list");
						culledProducts.splice(product);
					}
				}

				resolve('BrandB resolved with toDelete count: '+ toDelete.length); //resolve promise after toDelete is updated
				
				for (var i = 0; i < culledProducts.length; i++) {

					var firstProduct = culledProducts[i];

					if(newProducts.indexOf(firstProduct["strProductName"])<0 && oldProducts.indexOf(product["strProductName"])<0){

						newProducts.push(firstProduct["strProductName"]);

						var newItem = Parse.Object.extend("Item");
						
						var item = new newItem();
						item.set("dealType", "product"); //dealtype can be service as well.
						item.set("price", Number(firstProduct["dblProductSalePrice"]));
						item.set("priceOrig", Number(firstProduct["dblProductPrice"]));
						item.set("savePercent", round(Number(firstProduct["dblProductOnSalePercent"]),2));
						item.set("detailDescription", firstProduct["txtAbbreviatedDescription"]);
						item.set("description", firstProduct["strProductName"]);
						item.set("detailTitle", firstProduct["strProductName"]); // needs logic to have a snappy call to action for each item
						item.set("seller", firstProduct["strBrandName"]);
						item.set("name", firstProduct["strProductSKU"]);
						item.set("location", "National");
						item.set("badges", findLevel(firstProduct["dblProductPrice"],firstProduct["dblProductSalePrice"])); //needs to create some logic for determining badge requirements
						item.set("buyURL", firstProduct["strBuyURL"]);
						item.set("category");

						console.log('Product Level for ' + firstProduct["strProductName"] + ': ' + findLevel(firstProduct["dblProductPrice"],firstProduct["dblProductSalePrice"]));

						imageRequest(firstProduct["strLargeImage"], item); //need to scope out the next request otherwise product saving doesn't work properly

					}
				}

			}
		};
		request(options, callback);
	});
}

//----- Helper Functions -----
function imageRequest(passedImgUrl,passedItem){
	request(passedImgUrl, function (error, response, body ) {
		
		if (!error && response.statusCode == 200) {
			data = "data:" + response.headers["content-type"] + ";base64," + new Buffer(body).toString('base64');
			var imageFile = new Parse.File("img.jpg",{base64: data});
			imageFile.save().then(function() {
			  //IF IMAGE DOES NOT SAVE AND THERE IS NO ERROR CODE, DATABASE MAY BE RUNNING LOW ON ALLOCATED DATA
			  //console.log('image saved');
			  passedItem.set("image", imageFile);
			  passedItem.save(null, {
			  	success: function(item) {
			  		console.log('New object created with objectId: ' + item.id);
			  	},
			  	error: function(item, error) {
			  		console.log('Failed to create new object, with error code: ' + error.message);
			  	}
			  });
			});
		}
		else{
			console.log('image not found');
		}
	});
}

//This function will determine how to sort each product into our database by searching for 
//keywords within the product's meta-data, which is unpredictable.
//Note that the different sources have different sorting needs
function category(product,source){
	console.log('finding category');
	var activityDict = {
		"Baseball" : ["baseball"],
		"Basketball" : ["basketball", "hoops", "b-ball"],
		"Climbing" : ["climb", "climbing"],
		"Soccer" : ["soccer", "futbol"],
		"Football" : ["football","footballs"],
		"Running" : ["run", "running","trailrunning"],
		"Hiking" : ["hike", "hiker", "trek", "trekking", "hikesofinstagram", "hiking", "backpacking"],
		"Softball" : ["softball","softballs"],
		"Yoga" : ["yogi","yogagirl", "yoga", "downwardfacingdog", "nameste", "namaste", "bikram", "treepose"],
		"Fitness" : ["workout","workouts", "fitness", "gym","gyms", "weights","lift","lifts", "lifting", "swim", "swims", "swimming", "aerobics", "train", "training", "tights", "legging", "activewear"],
		"Hockey" : ["hockey"],
		"Cycling" : ["bike", "bikes", "biking", "cycle", "cycling", "MTB"],
		"Golf" : ["golf", "golfing", "drivingrange"],
		"Tennis" : ["tennis"]
	};

	if (source === 'SourceA'){

		var deptString = product["strDepartmentName"];
		var descString = product["strProductName"];
		var catNameString = product["strCategoryName"];

		for (var key in activityDict) {
			var valueArray = activityDict[key];
			for (var word in valueArray){
				if (~deptString.toLowerCase().indexOf(valueArray[word])){
					return key;
				}
				else if (~descString.toLowerCase().indexOf(valueArray[word])){
					return key;
				}
				else if (~catNameString.toLowerCase().indexOf(valueArray[word])){
					return key;
				}
			}
		}
	return "Climbing";
	}
	else if (source === 'SourceB'){

		//Special case correction for items of this particular brand
		if (product["brand"] === 'Jordan'){
			return "Basketball";
		}

		var deptString = product["secondaryCategory"];
		var descString = product["name"];

		for (var key in activityDict) {
			var valueArray = activityDict[key];
			for (var word in valueArray){
				if (~deptString.toLowerCase().indexOf(valueArray[word])){
					return key;
				}
				if (~descString.toLowerCase().indexOf(valueArray[word])){
					return key;
				}
			}
		}

		var deptName = product["secondaryCategory"];
		var catString = deptName.split("~~");
		var cats = catString[catString.length-1];
		var subCatString = cats.split(" ");

		var newCatString = catCorrect(subCatString[0]);

		return newCatString;
	}
}

//Randomly generates product ID.
function makeid(){
	var text = "";
	var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for( var i=0; i < 5; i++ ){
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function emptyItems(){
	var query = new Parse.Query('Item');
	query.limit(1000); //default is 100, so this ensures all objects are deleted
	query.find().then(function (items) {

		items.forEach(function(item) {
			//Delete image for product
			var oldImage = item.get("image");
			var oldImageShort = oldImage["_url"].split("/");
			var oldImageName = oldImageShort[oldImageShort.length-1];
			console.log("Old image esists with name: " + oldImageName);
									
			s3Adapter.deleteFile(oldImageName).then(function (error, response) {
				console.log("deleted "+response.success);
			});				

			//Delete empty product	
			item.destroy({
				success: function() {
					// SUCCESS CODE HERE, IF YOU WANT
				},
				error: function() {
					// ERROR CODE HERE, IF YOU WANT
				}
			});
		});
	}, 
	function (error) {
		response.error(error);
	});
}

function deleteExpiredItems(){
	console.log('deleting '+toDelete.length+' expired items')
	toDelete.forEach(function(item) {
		//Delete image for product
		var oldImage = item.get("image");
		var oldImageShort = oldImage["_url"].split("/");
		var oldImageName = oldImageShort[oldImageShort.length-1];
		//console.log(oldImageName);
		
		s3Adapter.deleteFile(oldImageName).then(function (error, response) {
			//console.log("deleted "+response.success);
		});
		
		
		//Delete product
		
		item.destroy({
			success:function() {
					 // SUCCESS CODE HERE, IF YOU WANT
					},
			error:function() {
			 // ERROR CODE HERE, IF YOU WANT
			}
		});							
	});
}

function round(value, decimals) {
	return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
}

function catCorrect(string){
	if ((string === "Biking")|(string === "Cycle")|(string === "Cycling")|(string ==="Bike")){
		return "Cycling";
	}

	if ((string === "Activewear")|(string === "Clothing")){
		return "Apparel";
	}

	if ((string === "Climb")|(string === "Rock Climbing")){
		return "Climbing";
	}
	return string;
}

function loadItems(){
	return new Promise(function(resolve, reject) {
		var query = new Parse.Query('Item');
		query.limit(1000); //default is 100, so this ensures all objects are deletes
		query.find().then(function (items) {
			toDelete = items;
			for (var i = 0; i < items.length; i++) {
				var item = items[i];
				toDeleteNames.push(item.get("detailTitle"));
				oldProducts.push(item.get("detailTitle"));
			}
			//console.log("loaded "+items.length+" items");
			//console.log(toDeleteNames);
			//refreshProducts(); // run all refreshes
			resolve("loaded "+toDeleteNames.length+" items");
			}, function (error) {
				//response.error(error);
				reject("items not loaded with error: "+error);
			}
		);
	});
}

//In my implementation of this tool, each product had an associated "level", 
//where by the deals would be sorted based on the size of their discounts
function findLevel(originalPrice, salePrice){
	var savings = originalPrice-salePrice;
	var badgeLevel = Math.round(savings/20);
	if (badgeLevel>5){
		badgeLevel = 5;
	}
	return Number(badgeLevel);
}

function commandChain(){
	//load existing products from Parse and fill toDelete
	loadItems().then(function(response) {
		console.log("Step 1 Complete:", response);
		Promise.all([

			//the sequence should be as follows:
			//1. Load existing items from parse
			//2. Create all new objects, checking if they already exist in parse along the way
			//    a.**need to make sure that all refresh functions run and complete before moving on.
			//3. Delete those objects left over which existed in parse prior to creating new objects.

			refreshBrandB('hike','160'),
			refreshBrandB('run','160'),
			refreshBrandB('climb','160'),
			refreshBrandB('bike','180'),
			refreshBrandC(),
			refreshBrandA()
			]).then(function(responses){
				console.log("Step 2 Complete:", responses);

				//Delete all PFObjects left in toDelete
				deleteExpiredItems();

			},function(errors){
				console.log("Step 2 Failed:",errors);
			});
	}, function(error) {
			console.error("Step 1 Failed:", error);
	})
}

//This script ends calling the main command sequence.
commandChain();

