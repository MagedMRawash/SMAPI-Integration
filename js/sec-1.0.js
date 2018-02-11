/*!
 * SEC JavaScript Library
 *
 * Revision: 6d66b44b19062e68c882bb4998a20ca8e4bbd609
 * Version: 1.0
 */
(function (exports, global) {

    "use strict";

    var _ = {};
    exports.internal = _;

    exports.debugLogEnabled = false;

    _.debug = function (x) {
        if (exports.debugLogEnabled) {
            console.log(x);
        }
    };

    _.removeAllElements = function (array) {
        array.length = 0;
    };

    _.addElements = function (array, elements) {
        elements.forEach(function (element) {
            array.push(element);
        });
    };

    _.contains = function (array, element) {
        return array.indexOf(element) >= 0;
    };

    _.isUndefined = function (x) {
        return typeof(x) === 'undefined';
    };

    _.setDefault = function (obj, key, defaultValue) {
        if (_.isUndefined(obj[key])) {
            obj[key] = defaultValue;
        }
    };

    _.forKeyValue = function (obj, f) {
        var key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                f(key, obj[key]);
            }
        }
    };

    _.merge = function (obj, defaults) {
        _.forKeyValue(defaults, function (key, value) {
            _.setDefault(obj, key, value);
        });
    };

    _.bytesFrom = function (aString) {
        var bytes = [];
        for (var i = 0; i < aString.length; ++i) {
            bytes.push(aString.charCodeAt(i));
        }
        return bytes;
    };

    _.enricherWith = function (enrichment) {
        return function (obj) {
            _.merge(obj, enrichment);
        };
    };

    _.setHeaders = function (xhr, headers) {
        _.forKeyValue(headers, function (header, headerValue) {
            xhr.setRequestHeader(header, headerValue);
        });
    };

    _.httpAsyncDefault = true;

    _.http = function (opts) {
        _.setDefault(opts, 'async', _.httpAsyncDefault); // hack to allow submitting events synchronously when browser is closed
        _.setDefault(opts, 'data', null);
        _.setDefault(opts, 'headers', {});

        var xhr = new XMLHttpRequest();
        xhr.open(opts.method, opts.url, opts.async);
        _.setHeaders(xhr, opts.headers);
        if (opts.async) {
            if (opts.onSuccess) {
                xhr.onload = function () {
                    opts.onSuccess(xhr.responseText, xhr.status);
                };
            }
            if (opts.onError) {
                xhr.onerror = function () {
                    opts.onError(xhr.responseText, xhr.status);
                };
            }
            xhr.send(opts.data);
            return null;
        } else {
            xhr.send(opts.data);
            return {
                responseText: xhr.responseText,
                status: xhr.status
            };
        }
    };

    _.serializer = function (type) {
        if (type.indexOf("json") !== -1) {
            return JSON.stringify;
        } else {
            throw new Error("cannot serialize data to " + type);
        }
    };

    _.submitLink = function (linkDescription, headers, http, gzipCompressor) {
        if (!linkDescription) { // this happens when client is blocked
            _.debug("link description missing, will not make http requests");
            return function (data) {
                return null;
            };
        }

        var serializer = _.serializer(linkDescription.type);
        return function (data) {
            var reqHeaders = {'Content-Type': linkDescription.type};
            var serializedData = serializer(data);
            if (gzipCompressor) {
                serializedData = gzipCompressor(_.bytesFrom(serializedData));
                _.merge(reqHeaders, {'Content-Encoding': "gzip"});
            }
            _.merge(reqHeaders, headers);
            _.debug(linkDescription.method + "ing " + serializedData + " to " + linkDescription.href);
            http({
                method: linkDescription.method,
                url: linkDescription.href,
                headers: reqHeaders,
                data: serializedData
                // not setting 'async' here to make sure the default value is picked up
            });
        };
    };


    _.getClientSettings = function (linkDescription, metaData) {
        if (linkDescription === undefined) { // this happens when client is blocked
            _.debug("link description missing, will not make http request to get client settings");
            return null;
        }

        var headers = {'Accept': linkDescription.type};
        _.merge(headers, metaData);
        var response = _.http({
            method: 'GET',
            url: linkDescription.href,
            headers: headers,
            async: false
        });
        if (response.status >= 200 && response.status < 400) {
            return JSON.parse(response.responseText);
        } else {
            throw new Error("failed to GET client settings from " + linkDescription.href);
        }
    };

    _.getHomeDoc = function (homeDocUrl, metaData) {
        var headers = {Accept: 'application/json'};
        _.merge(headers, metaData);
        var response = _.http({
            method: 'GET',
            url: homeDocUrl,
            headers: headers,
            async: false
        });
        if (response.status >= 200 && response.status < 400) {
            return JSON.parse(response.responseText);
        } else {
            throw new Error("failed to GET home document from " + homeDocUrl);
        }
    };

    _.submitEventsLink = function (homeDoc) {
        return homeDoc.links ? homeDoc.links['http://a42.vodafone.com/rels/sec/submit-events'] : null;
    };

    _.clientSettingsLink = function (homeDoc) {
        return homeDoc.links ? homeDoc.links['http://a42.vodafone.com/rels/sec/settings'] : null;
    };

    _.payloads = function (events) {
        return events.map(function (event) {
            return event.payload;
        });
    };

    _.validateEvent = function (event) {
        if (!event.payload || typeof event.payload !== 'object') {
            throw new Error("missing payload object in event " + JSON.stringify(event));
        }
        if (_.isUndefined(event.payload['event-type'])) {
            throw new Error("missing event-type in event " + JSON.stringify(event));
        }
        if (!_.contains(['client', 'internal', 'request'], event.payload['event-type'])) {
            throw new Error("invalid event-type in event " + JSON.stringify(event));
        }
    };

    _.validateEvents = function (events) {
        events.forEach(_.validateEvent);
    };

    _.addTimestamp = function (events) {
        var date = new Date();
        _.payloads(events).forEach(_.enricherWith({
            'x-vf-trace-timestamp': date.toISOString()
        }));
    };

    _.throttle = function (throttledKeys, ignored) {
        return function (key, action) {
            if (!throttledKeys.contains(key)) {
                return action();
            } else {
                return ignored;
            }
        };
    };

    _.throttleFreeEventsFilter = function (cache) {
        var throttle = _.throttle(cache);
        return function (events) {
            var throttleFreeEvents = [];
            events.forEach(function (event) {
                var duplication = event.duplication;
                if (duplication) {
                    throttle(duplication.key, function () {
                        // this is only done if the duplication.key is new (or the time elapsed)
                        throttleFreeEvents.push(event);
                        cache.put(duplication.key, duplication.repeatSeconds);
                    });
                } else {
                    throttleFreeEvents.push(event);
                }
            });
            return throttleFreeEvents;
        };
    };

    _.TemporaryCache = function () {
        var cache = {};
        this.contains = function (item) {
            return !_.isUndefined(cache[item]);
        };
        this.put = function (item, ticks) {
            cache[item] = ticks;
            return this;
        };
        this.advanceTime = function (ticks) {
            var newCache = {};
            _.forKeyValue(cache, function (item, remainingTicks) {
                var newTicks = remainingTicks - ticks;
                if (newTicks > 0) {
                    newCache[item] = newTicks;
                }
            });
            cache = newCache;
        };
        this.startClock = function () {
            var self = this;
            setInterval(function () {
                self.advanceTime(1);
            }, 1000);
            return this;
        };
        this._ticksFor = function (key) { // for testing
            return cache[key];
        };
    };

    _.Cron = function (task, repeatSeconds) {
        var lastRun = new Date();
        this.delay = function () {
            lastRun = new Date();
        };
        setInterval(function () {
            var now = new Date();
            var millisSinceLastRun = now.getTime() - lastRun.getTime();
            if (millisSinceLastRun >= (repeatSeconds * 1000)) {
                lastRun = now;
                task();
            }
        }, 500);
    };

    _.Buffer = function (size, onFullHandler, bufferFlushSeconds) {
        var bufferedElements = [];
        var cron;
        this.flush = function () {
            if (bufferedElements.length > 0) {
                if (!_.isUndefined(onFullHandler)) {
                    _.debug("calling onFullHandler on " + JSON.stringify(bufferedElements));
                    onFullHandler(bufferedElements);
                }
                _.removeAllElements(bufferedElements);
                if (cron) cron.delay();
                _.debug("buffer flushed");
            }
        };
        this.add = function (elements) {
            _.addElements(bufferedElements, elements);
            _.debug("buffering " + elements.length + " new element(s), " +
                "buffer has " + bufferedElements.length + " element(s)");
            if (bufferedElements.length > size) {
                this.flush();
            }
        };
        this.clear = function () {
            _.removeAllElements(bufferedElements);
            _.debug("buffer cleared");
        };
        this._elements = bufferedElements; // for testing

        if (size > 0 && bufferFlushSeconds) {
            cron = new _.Cron(this.flush, bufferFlushSeconds);
        }
    };

    _.browserCloseEvents = [
        {payload: {
            'event-type': "client",
            'event-context': "window closed",
            tags: ["generated_by_seclib"]
        }}
    ];

    _.createCloseHandler = function (eventSubmitter) {
        var done;
        return function () {
            if (!done) {
                done = true;
                _.httpAsyncDefault = false; // submit events synchronously before window is unloaded
                eventSubmitter.submitEvents(_.browserCloseEvents);
                eventSubmitter.flushBuffer();
            }
        };
    };

    _.handleBrowserClose = function (eventSubmitter) {
        var onClose = _.createCloseHandler(eventSubmitter);
        if (global.addEventListener) {
            global.addEventListener("beforeunload", onClose);
            global.addEventListener("unload", onClose);
        }
    };

    /**
     * Constructor for EventSubmitters. The created instance will try to send an event when the window is
     * unloaded so DO NOT CREATE MORE INSTANCES THAN YOU ACTUALLY NEED. There should only be one EventSubmitter
     * instance per event collector backend (usually one).
     *
     * @param homeDocUrl URL as string
     * @param metaData A map of headers that will be set on every request to SEC. E.g.
     *      {
     *          'x-vf-trace-source': <traceSource>,
     *          'x-vf-trace-source-version': <traceSourceVersion>,
     *          'x-vf-trace-subject-id': <traceSubjectId>,
     *          'x-vf-trace-subject-region': <traceSubjectRegion>
     *      }
     * @param opts An optional map of configuration options. Supported options are:
     *      {
     *          'bufferSize': <positiveInteger> // Number of events that should be buffered before sending the events
     *                                          // to the server. Defaults to '0' which means that all events are submitted
     *                                          // immediately.
     *          'bufferFlushSeconds': <positiveInteger> // Number of seconds after which the events buffer will be flushed
     *                                                  // in case of inactivity. This also happens if the buffer is not
     *                                                  // completely full.
     *          'gzipCompressor': <function> // A function from byte array to compressed byte array. If this is
     *                                       // set, submitted events are compressed and the Content-Encoding header is
     *                                       // set to 'gzip'.
     *      }
     */
    exports.EventSubmitter = function (homeDocUrl, metaData, opts) {
        if (_.isUndefined(opts)) opts = {};
        _.setDefault(opts, 'bufferSize', 0);

        var homeDoc = _.getHomeDoc(homeDocUrl, metaData);
        var submitEvents = _.submitLink(_.submitEventsLink(homeDoc),
            metaData, _.http, opts.gzipCompressor);
        var buffer = new _.Buffer(opts.bufferSize, submitEvents, opts.bufferFlushSeconds);
        var tempCache = new _.TemporaryCache().startClock();
        var removeThrottledEvents = _.throttleFreeEventsFilter(tempCache);

        this.submitEvents = function (events) {
            var eventsToSubmit = removeThrottledEvents(events);
            _.validateEvents(eventsToSubmit);
            _.addTimestamp(eventsToSubmit);
            buffer.add(_.payloads(eventsToSubmit));
        };
        this.submitEvent = function (event) {
            this.submitEvents([event]);
        };
        this.getSettings = function () {
            return _.getClientSettings(_.clientSettingsLink(homeDoc), metaData);
        };
        this.flushBuffer = function () {
            buffer.flush();
        };
        this.clearBuffer = function () {
            buffer.clear();
        };
        this._buffer = buffer; // for testing
        this._render = function () { // for sec-demo.html
            var functionSerializer = function (key, value) {
                if (typeof(value) === "function") {
                    return "function() {...}";
                }
                return value;
            };
            return JSON.stringify({
                serviceDocument: homeDocUrl,
                headers: metaData,
                configuration: opts,
                buffer: buffer._elements
            }, functionSerializer, 2);
        };
        _.handleBrowserClose(this);
    };
})(typeof exports === 'undefined' ? this.sec = {} : exports, this);
