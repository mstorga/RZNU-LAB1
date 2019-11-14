let express = require('express');
let functions = require('./functions.js');
let moment = require('moment');
let colors = require('colors');
let app = express();

let ejs = require('ejs'), bodyParser = require('body-parser'),
    http = require('http').Server(app), mongo = require('mongodb').MongoClient;

app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.engine('html', ejs.renderFile);

function mongoConnection(callback) {
    mongo.connect(process.env.MONGODB_URI, {useNewUrlParser: true}, function (err, database) {
        if (err) logErr(err);
        callback(database);
    });
}

app.get('/clientQueryPts', (req, res) => {
    if (checkAuthorization(req.query.pass, res))
        mongoConnection((database) => {
            database.db(process.env.MONGODB_DATABASE).collection('search_results').aggregate([{
                $group: {
                    _id: {
                        query: "$query",
                        pt: "$pt",
                        client: "$client"
                    }
                }
            }]).toArray(function (err, result, c) {
                if (err) logErr(err);
                result = result.map(r => r._id);
                res.send(result);
                database.close();
            })
        });
});

app.get('/templates', (req, res) => {
    if (checkAuthorization(req.query.pass, res))
        mongoConnection((database) => {
            database.db(process.env.MONGODB_DATABASE).collection('result_templates').find({}, {projection: {_id: 0}}).toArray((err, messages) => {
                res.send(messages);
                database.close();
            });
        });
});

app.get('/checkPass', (req, res) => {
    if (checkAuthorization(req.query.pass, res))
        res.send('ok');
});

let results;
let mapTokensWithAppName = {};
app.get('/export', async (req, res) => {
    if (checkAuthorization(req.query.pass, res)) {
        let token = mapTokensWithAppName[req.query.appName];
        if (token) {
            results = '';
            gatherLogsAndSendResponse(res, token, req.query.query, req.query.date1 ? req.query.date1 : null, req.query.date2,
                req.query.min_id ? req.query.min_id : null, req.query.max_id ? req.query.max_id : null);
        } else {
            res.send('Add papertrail token for ' + req.query.appName + ' to mongodb');
        }
    }
});

app.get('/getTokens', (req, res) => {
    mapTokensWithAppName = {};
    if (checkAuthorization(req.query.pass, res)) {
        mongoConnection((database) => {
            database.db(process.env.MONGODB_DATABASE).collection('papertrail_tokens').find({}, {
                projection: {
                    _id: 0,
                    min_ids: 0,
                    logMonitor: 0
                }
            }).toArray((err, messages) => {
                let names = [];
                for (let m of messages) {
                    mapTokensWithAppName[m.app_name] = m.token;
                    names.push(m.app_name);
                }
                res.send(names);
                database.close()
            });
        });
    }
});

app.get('/results', (req, res) => {
    let cl;
    if(req.query.cl)
        cl = JSON.parse(req.query.cl);
    let qu;
    if(req.query.qu)
        qu = JSON.parse(req.query.qu);
    let pt;
    if(req.query.pt)
        pt = JSON.parse(req.query.pt);
    let isAjaxRequest = req.xhr;
    if (isAjaxRequest && checkAuthorization(req.query.pass, res)) {
        let endPlusOneDay = new Date(req.query.date2);
        endPlusOneDay.setDate(endPlusOneDay.getDate() + 1);
        let starTime = parseInt(Date.parse(req.query.date1) / 1000);
        let endTime = parseInt(endPlusOneDay / 1000);
        mongoConnection((database) => {
            database.db(process.env.MONGODB_DATABASE).collection('search_results').find({
                min_time: {
                    $gte: parseInt(starTime / 100000) * 100000,
                    $lte: parseInt(endTime / 100000) * 100000 + 99999
                }, client: {$in: cl}, query: {$in: qu}, pt: {$in: pt}
            }, {projection: {_id: 0}}).toArray((err, messages) => {
                for (let r of messages) {
                    let minT = r.min_time;
                    let arr = [];
                    for (let ts of r.ts) {
                        let time = minT + ts[0];
                        if (time >= starTime && time <= endTime)
                            arr.push(ts);
                    }
                    r.ts = arr;
                }
                res.send(messages);
                database.close();
            });
        });
    } else {
        let params = {
            date1: req.query.date1,
            date2: req.query.date2,
            freq: req.query.freq,
            chart: req.query.chart,
            scale: req.query.scale
        };
        if(pt)
            params.pt = pt;
        if(qu)
            params.qu = qu;
        if(cl)
            params.cl = cl;
        res.render(__dirname + "/public/index.html", {params: encodeURIComponent(JSON.stringify(params))});
    }
});

function checkAuthorization(pass, res) {
    if (pass !== process.env.app_password) {
        res.send('401 Unauthorized');
        return false;
    } else {
        return true;
    }
}

app.listen(process.env.PORT || 8080, function () {
    console.log('web running')
});

function gatherLogsAndSendResponse(response, token, searchQuery, date1, date2, min_id, max_id) {
    return new Promise(function (resolve, reject) {
        try {
            functions.sendPaperTrailApiRequest(function (res) {
                let parsedRes;
                try {
                    parsedRes = JSON.parse(res);
                } catch (err) {
                    console.log(parsedRes);
                    reject(err.message + " in " + res);
                    return;
                }
                if (parsedRes.reached_time_limit)
                    logErr('Papertrail’s per-request time limit (about 5 sec) was reached before a full set of events was found. (' + searchQuery + ')');
                if (parsedRes.reached_record_limit)
                    logErr('Papertrail’s per-request record limit reached (10000). (' + searchQuery + ')');
                if (parsedRes.events.length > 0)
                    console.log(colors.blue(moment().utc().format(process.env.MOMENT_DATE_TIME_FORMAT)) +
                        colors.green(' Export search found ') + colors.red(parsedRes.events.length) + colors.green(' events (' + searchQuery + ')'));
                //the subsequent response will include the previous oldest event reached as the latest event; discard it, as it was previously retrieved
                if (date1 && !date2)
                    parsedRes.events.pop();
                for (let event of parsedRes.events)
                    results += event.generated_at + ' ' + event.source_name + ' ' + event.program + ' '
                        + event.message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "") + '\n';
                parsedRes.events = [];
                resolve(parsedRes);
            }, token, "events/search.json", {
                "q": searchQuery,
                //convert miliseconds timestamp to seconds timestamp
                //search is going backwards if using max_id/max_time, always use max_id/max_time to maintain direction
                "min_time": date1 ? Math.floor(date1 / 1000.0) : null,
                "min_id": date1 ? null : (min_id ? min_id : 0),
                "max_id": max_id ? max_id : null,
                "max_time": max_id ? null : Math.floor((date2 ? date2 : Date.now()) / 1000.0),
                "tail": "false",
                "limit": "2000"
            });
        } catch (err) {
            reject(err);
        }
    }).then(async res => {
        if (res.reached_time_limit || res.reached_record_limit)
            response.send({done: false, results: results, max_id: res.min_id});
        else
            response.send({done: true, results: results});
    }, err => {
        logErr(err);
        response.send(err);
    });
}

function logErr(err) {
    console.log('%s ' + colors.red(err), colors.blue(moment().utc().format(process.env.MOMENT_DATE_TIME_FORMAT)));
}
