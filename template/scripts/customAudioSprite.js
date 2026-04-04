const fs = require('fs')
const path = require('path')
const async = require('async')
const _ = require('underscore')._
const glob = require('glob');

// ── FDK-AAC detection (cached per process) ───────────────────────────────────
const _fdkCache = {};
function hasFdkAac(ffmpegPath) {
    if (_fdkCache[ffmpegPath] !== undefined) return _fdkCache[ffmpegPath];
    try {
        const result = require('child_process').execFileSync(ffmpegPath, ['-encoders'], {
            timeout: 5000,
            maxBuffer: 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe']
        }).toString();
        _fdkCache[ffmpegPath] = result.includes('libfdk_aac');
    } catch (e) {
        // Some ffmpeg builds write -encoders to stderr and exit non-zero
        const stderr = e.stderr ? e.stderr.toString() : '';
        const stdout = e.stdout ? e.stdout.toString() : '';
        _fdkCache[ffmpegPath] = stderr.includes('libfdk_aac') || stdout.includes('libfdk_aac');
    }
    return _fdkCache[ffmpegPath];
}

const defaults = {
    output: 'output',
    path: '',
    export: 'ogg,aac',
    format: null,
    autoplay: null,
    loop: [],
    silence: 0,
    gap: 1,
    minlength: 0,
    bitrate: 64,
    vbr: -1,
    'vbr:vorbis': -1,
    samplerate: 44100,
    channels: 2,
    rawparts: '',
    ignorerounding: 0,
    logger: {
        debug: function() {},
        info: function() {},
        log: function() {}
    }
}

module.exports = function(ffmpegPath, files, opts, fileNumber, callback) {
    /*let opts = {}, callback = function(){}
  
    if (arguments.length === 2) {
      callback = arguments[1]
    } else if (arguments.length >= 3) {
      opts = arguments[1]
      callback = arguments[2]
    }*/

    if (!files || !files.length) {
        return callback(new Error('No input files specified.'))
    } else {
        files = _.flatten(files.map(file => glob.sync(file)));
        files = files.filter(function(file) {
            return file.endsWith(".wav") === true;
        });
    }

    opts = _.extend({}, defaults, opts)

    // make sure output directory exists
    let outputDir;
    if(fileNumber > 0) {
        outputDir = path.dirname(opts.output+fileNumber);
    }
    else {
        outputDir = path.dirname(opts.output);
    }
    
    if (!fs.existsSync(outputDir)) {
        require('mkdirp').sync(outputDir)
    }

    let offsetCursor = 0
    const wavArgs = ['-ar', opts.samplerate, '-ac', opts.channels, '-f', 's16le']
    const tempFile = mktemp('audiosprite')

    opts.logger.debug('Created temporary file', { file: tempFile })

    const json = {
        resources: [],
        spritemap: {}
    }

    const verProc = spawn(ffmpegPath, ['-version']);
    verProc.on('error', () => callback(new Error('ffmpeg was not found on your path')));
    verProc.on('exit', code => {
        if (code) {
            return callback(new Error('ffmpeg was not found on your path'))
        }

        if (opts.silence) {
            json.spritemap.silence = {
                start: 0,
                end: opts.silence,
                loop: true
            }

            if (!opts.autoplay) {
                json.autoplay = 'silence'
            }

            appendSilence(opts.silence + opts.gap, tempFile, processFiles)
        } else {
            processFiles()
        }
    })

    function mktemp(prefix) {
        var tmpdir = require('os').tmpdir() || '.';
        return path.join(tmpdir, prefix + '.' + Math.random().toString().substr(2));
    }

    function spawn(name, opt) {
        opts.logger.debug('Spawn', { cmd: [name].concat(opt).join(' ') });
        return require('child_process').spawn(name, opt);
    }

    function pad(num, size) {
        var str = num.toString();

        while (str.length < size) {
            str = '0' + str;
        }

        return str;
    }

    function makeRawAudioFile(src, cb) {
        var dest = mktemp('audiosprite')

        opts.logger.debug('Start processing', { file: src })

        fs.exists(src, function(exists) {
            if (exists) {
                let code = -1
                let signal = undefined
                let ffmpeg = spawn(ffmpegPath, ['-i', path.resolve(src)]
                    .concat(wavArgs).concat('pipe:'))
                let streamFinished = _.after(2, function() {
                    if (code) {
                        return cb({
                            msg: 'File could not be added',
                            file: src,
                            retcode: code,
                            signal: signal
                        })
                    }
                    cb(null, dest)
                });
                let writeStream = fs.createWriteStream(dest, { flags: 'w' })
                ffmpeg.stdout.pipe(writeStream)
                writeStream.on('close', streamFinished)
                ffmpeg.on('close', function(_code, _signal) {
                    code = _code
                    signal = _signal
                    streamFinished()
                })
            } else {
                cb({ msg: 'File does not exist', file: src })
            }
        })
    }

    function appendFile(name, src, dest, cb) {
        var size = 0
        var reader = fs.createReadStream(src)
        var writer = fs.createWriteStream(dest, {
            flags: 'a'
        })
        reader.on('data', function(data) {
            size += data.length
        })
        reader.on('close', function() {
            var originalDuration = size / opts.samplerate / opts.channels / 2
            opts.logger.info('File added OK', { file: src, duration: originalDuration })
            var extraDuration = Math.max(0, opts.minlength - originalDuration)
            var duration = originalDuration + extraDuration
            json.spritemap[name] = {
                start: offsetCursor,
                end: offsetCursor + duration,
                loop: name === opts.autoplay || opts.loop.indexOf(name) !== -1
            }
            offsetCursor += originalDuration

            var delta = 0;

            if (!opts.ignorerounding && opts.gap >= 1) {
                delta = Math.ceil(duration) - duration;
            }

            appendSilence(extraDuration + delta + opts.gap, dest, cb)
        })
        reader.pipe(writer)
    }

    function appendSilence(duration, dest, cb) {
        var buffer = Buffer.alloc(Math.round(opts.samplerate * 2 * opts.channels * duration))
        buffer.fill(0)
        var writeStream = fs.createWriteStream(dest, { flags: 'a' })
        writeStream.end(buffer)
        writeStream.on('close', function() {
            opts.logger.info('Silence gap added', { duration: duration })
            offsetCursor += duration
            cb()
        })
    }

    function exportFile(src, dest, ext, opt, store, cb) {
        var outfile = dest + '.' + ext;

        spawn(ffmpegPath, ['-y', '-ar', opts.samplerate, '-ac', opts.channels, '-f', 's16le', '-i', src]
                .concat(opt).concat(outfile))
            .on('exit', function(code, signal) {
                if (code) {
                    return cb({
                        msg: 'Error exporting file',
                        format: ext,
                        retcode: code,
                        signal: signal
                    })
                }
                if (ext === 'aiff') {
                    exportFileCaf(outfile, dest + '.caf', function(err) {
                        if (!err && store) {
                            json.resources.push(dest + '.caf')
                        }
                        fs.unlinkSync(outfile)
                        cb()
                    })
                } else {
                    opts.logger.info('Exported ' + ext + ' OK', { file: outfile })
                    if (store) {
                        json.resources.push(outfile)
                    }
                    cb()
                }
            })
    }

    function exportFileCaf(src, dest, cb) {
        if (process.platform !== 'darwin') {
            return cb(true)
        }

        spawn('afconvert', ['-f', 'caff', '-d', 'ima4', src, dest])
            .on('exit', function(code, signal) {
                if (code) {
                    return cb({
                        msg: 'Error exporting file',
                        format: 'caf',
                        retcode: code,
                        signal: signal
                    })
                }
                opts.logger.info('Exported caf OK', { file: dest })
                return cb()
            })
    }

    function processFiles() {
        var formats = {
            aiff: [],
            wav: [],
            aac: ['-ab', opts.bitrate + 'k'],
            ac3: ['-acodec', 'ac3', '-ab', opts.bitrate + 'k'],
            mp3: ['-ar', opts.samplerate, '-f', 'mp3'],
            mp4: ['-ab', opts.bitrate + 'k'],
            m4a: (hasFdkAac(ffmpegPath) && !opts.useNativeAac)
                ? ['-c:a', 'libfdk_aac', '-b:a', opts.bitrate + 'k', '-afterburner', '1']
                : ['-ab', opts.bitrate + 'k', '-strict', '-2'],
            ogg: ['-acodec', 'libvorbis', '-f', 'ogg', '-ab', opts.bitrate + 'k'],
            opus: ['-acodec', 'libopus', '-ab', opts.bitrate + 'k'],
            webm: ['-acodec', 'libvorbis', '-f', 'webm', '-dash', '1']
        };

        if (opts.vbr >= 0 && opts.vbr <= 9) {
            formats.mp3 = formats.mp3.concat(['-aq', opts.vbr])
        } else {
            formats.mp3 = formats.mp3.concat(['-ab', opts.bitrate + 'k'])
        }

        // change quality of webm output - https://trac.ffmpeg.org/wiki/TheoraVorbisEncodingGuide
        if (opts['vbr:vorbis'] >= 0 && opts['vbr:vorbis'] <= 10) {
            formats.webm = formats.webm.concat(['-qscale:a', opts['vbr:vorbis']])
        } else {
            formats.webm = formats.webm.concat(['-ab', opts.bitrate + 'k'])
        }

        if (opts.export.length) {
            formats = opts.export.split(',').reduce(function(memo, val) {
                if (formats[val]) {
                    memo[val] = formats[val]
                }
                return memo
            }, {})
        }

        var rawparts = opts.rawparts.length ? opts.rawparts.split(',') : null
        var i = 0
        opts.logger.info(files);
        async.forEachSeries(files, function(file, cb) {
            i++

            makeRawAudioFile(file, function(err, tmp) {
                if (err) {
                    opts.logger.debug(err);
                    return cb(err)
                }

                function tempProcessed() {
                    fs.unlinkSync(tmp)
                    cb()
                }

                var name = path.basename(file).replace(/\.[a-zA-Z0-9]+$/, '')
                appendFile(name, tmp, tempFile, function(err) {
                    if (rawparts != null ? rawparts.length : void 0) {
                        async.forEachSeries(rawparts, function(ext, cb) {
                            opts.logger.debug('Start export slice', { name: name, format: ext, i: i })
                            exportFile(tmp, opts.output + '_' + pad(i, 3), ext, formats[ext], false, cb)
                        }, tempProcessed)
                    } else {
                        tempProcessed()
                    }
                })
            })
        }, function(err) {
            if (err) {
                return callback(new Error('Error adding file ' + (err.msg || err.message || JSON.stringify(err))))
            }

            async.forEachSeries(Object.keys(formats), function(ext, cb) {
                opts.logger.debug('Start export', { format: ext })
                if(fileNumber>0) {
                    exportFile(tempFile, opts.output+fileNumber, ext, formats[ext], true, cb);
                } else {
                    exportFile(tempFile, opts.output, ext, formats[ext], true, cb);
                }
                
            }, function(err) {
                if (err) {
                    return callback(new Error('Error exporting file'))
                }
                if (opts.autoplay) {
                    json.autoplay = opts.autoplay
                }

                json.resources = json.resources.map(function(e) {
                    return opts.path ? path.join(opts.path, path.basename(e)) : e
                })

                var finalJson = {}

                switch (opts.format) {

                    case 'howler':
                    case 'howler2':
                        finalJson[opts.format === 'howler' ? 'urls' : 'src'] = [].concat(json.resources)
                        finalJson.sprite = {}
                        for (var sn in json.spritemap) {
                            var spriteInfo = json.spritemap[sn]
                            finalJson.sprite[sn] = [spriteInfo.start * 1000, (spriteInfo.end - spriteInfo.start) * 1000]
                            if (spriteInfo.loop) {
                                finalJson.sprite[sn].push(true)
                            }
                        }
                        break

                    case 'createjs':
                        finalJson.src = json.resources[0]
                        finalJson.data = { audioSprite: [] }
                        for (var sn in json.spritemap) {
                            var spriteInfo = json.spritemap[sn]
                            finalJson.data.audioSprite.push({
                                id: sn,
                                startTime: spriteInfo.start * 1000,
                                duration: (spriteInfo.end - spriteInfo.start) * 1000
                            })
                        }
                        break

                    case 'default':
                    default:
                        finalJson = json
                        break
                }

                fs.unlinkSync(tempFile)
                callback(null, finalJson)
            })
        })
    }
}