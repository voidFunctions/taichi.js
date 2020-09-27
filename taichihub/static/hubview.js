class HubView {
    constructor(canvas, editor, shaderName) {
        this.paused = false;
        this.frame = 0;

        this.canvas = canvas;
        this.editor = editor;
        this.shaderName = shaderName;
        this.title = null;

        if (this.shaderName != null) {
            this.doLoad(this.shaderName);
        }
    }

    bindButtons() {
        $('#button-pause').click(this.onPause.bind(this));
        $('#button-reset').click(this.onReset.bind(this));
        $('#button-save').click(this.onSave.bind(this));
        $('#button-load').click(this.onLoad.bind(this));
        $('#button-run').click(this.onRun.bind(this));
    }

    terminate() {
        this.frame = 0;
        if (typeof this.gui != 'undefined')
            this.gui.stopped = true;
        this.gui = undefined;
    }

    play() {
        this.terminate();

        this.gui = new TaichiGUI(this.canvas, 512);

        this.reset = this.program.get('reset');
        this.substep = this.program.get('substep');
        this.render = this.program.get('render');

        let substep_nr = this.program.get('hub_get_substep_nr');
        if (typeof substep_nr != 'undefined') {
            substep_nr();
            this.substep_nr = this.program.get_ret_int(0);
        } else {
            this.substep_nr = 1;
        }

        this.scene_type = undefined;
        this.export_data = undefined;
        if (typeof this.export_data == 'undefined') {
            this.export_data = this.program.get('hub_get_image');
            this.scene_type = 'image';
        }
        if (typeof this.export_data == 'undefined') {
            this.export_data = this.program.get('hub_get_particles');
            this.scene_type = 'particles';
        }
        if (typeof this.render == 'undefined' && typeof this.substep == 'undefined') {
            console.error('Cannot find the kernel to render / step data!');
        }
        if (typeof this.export_data == 'undefined') {
            console.error('Cannot find the kernel to export data!');
        }

        if (typeof this.reset != 'undefined') {
            this.reset();
        }
        this.onReset();

        this.fps = 0;
        this.last_time = Date.now();
        this.gui.animation(this.perFrame.bind(this));
    }

    onUpdate() {
        this.program.set_arg_float(0, this.frame * 0.04);
        if (typeof this.substep != 'undefined') {
            for (var i = 0; i < this.substep_nr; i++) {
                this.substep();
            }
        }
        if (typeof this.render != 'undefined') {
            this.render();
        }

        if (this.scene_type == 'image') {
            let extr = this.program.set_ext_arr(0, [this.gui.resx, this.gui.resy, 4]);
            this.export_data();
            this.gui.set_image(extr);
        } else if (this.scene_type == 'particles') {
            let extr = this.program.set_ext_arr(0, [0, 2]);
            this.export_data();
            this.program.get_ret_float(0);
            this.gui.circles(extr);
        }
    }

    perFrame() {
        if (this.paused)
            return;

        if((Date.now() - this.last_time) >= 1000) {
            $('#label-fps').html(this.fps + ' FPS');
            this.last_time = Date.now();
            this.fps = 0;
        }
        this.onUpdate();
        this.fps++;
        this.frame++;
    }

    loadShader(url) {
        $.ajax({
            url: url,
            type: 'GET',
            dataType: 'text',
            success: function(res) {
                $('#label-savestatus').html('loaded');
                console.log('Successfully loaded shader:', url);
                this.editor.setValue(res);
                this.onRun();
            }.bind(this),
            error: function(xmlhr, err, exc) {
                $('#label-status').html('error');
                alert('Error loading shader: ' + err + exc);
            },
        });
    }

    loadScript(url) {
        $.ajax({
            url: url,
            type: 'GET',
            dataType: 'text',  // we will evaluate it ourself
            data: { dummy: Date.now() },
            success: function(res) {
                $('#label-status').html('loaded');
                console.log('Successfully loaded:', url);
                let module = eval('(function mod' + Date.now() + '() { ' + res + '; return Module; })()');
                console.log(module);
                this.program = new Taichi(module);

                this.program.ready(function() {
                    console.log('Replaying program...');
                    $('#label-status').html('ready');
                    this.play(this.program);
                }.bind(this));
            }.bind(this),
            error: function(xmlhr, err, exc) {
                $('#label-status').html('error');
                alert('Error loading compiled script: ' + err + exc);
            },
        });
    }

    onPause() {
        this.paused = !this.paused;
        $('#icon-pause').html(this.paused ? 'play_arrow' : 'pause');
    }

    onReset() {
        this.frame = 0;
        if (typeof this.reset != 'undefined') {
            this.reset();
        }
        this.onUpdate();
    }

    onSave() {
        if ($('#label-status').html() != 'ready') {
            alert('The shader must RUN successfully (ready) before save!');
            return;
        }
        var code = this.editor.getValue();
        var name = this.shaderName;
        $('#label-savestatus').html('saving');

        function entitledCallback(title) {
            this.title = title;
            $.ajax({
                type: 'POST',
                url: '/save',
                data: {name: name, code: code, title: title },
                datatype: 'json',
                success: function(res) {
                    console.log('Server load result:', res);
                    $('#label-savestatus').html(res.status);
                    if (res.status == 'conflict') {
                        alert('Name already used by other users: ' + name);
                    }
                },
                error: function(xmlhr, err, exc) {
                    $('#label-savestatus').html('error');
                    alert('Error requesting server: ' + err + exc);
                },
            });
        }

        mdui.prompt('Please input the title of this shader:', 'Save', entitledCallback.bind(this));
    }

    onLoad() {
        var name = $('#text-load-name').val();
        this.doLoad(name);
    }

    doLoad(name) {
        $.ajax({
            type: 'GET',
            url: '/load',
            data: {name: name},
            datatype: 'json',
            success: function(res) {
                console.log('Server load result:', res);
                if (res.status == 'found') {
                    this.title = res.title;
                    this.loadShader('/cache/' + res.cacheid);
                } else if (res.status == 'notfound') {
                    res.status = 'new';
                }
                $('#label-savestatus').html(res.status);
                if (res.status == 'new') {
                    this.onRun();
                }
            }.bind(this),
            error: function(xmlhr, err, exc) {
                $('#label-savestatus').html('error');
                alert('Error requesting server: ' + err + exc);
            },
        });
    }

    onRun() {
        $('#label-status').html('compiling');
        var code = this.editor.getValue();
        $.ajax({
            type: 'POST',
            url: '/compile',
            data: {code: code},
            datatype: 'json',
            success: function(res) {
                console.log('Server compile result:', res);
                $('#label-status').html(res.status);
                if ('output' in res) {
                    $('#text-output').val(res.output);
                }
                if (res.status == 'success' || res.status == 'cached') {
                    this.loadScript(res.script);
                }
            }.bind(this),
            error: function(xmlhr, err, exc) {
                $('#label-status').html('error');
                alert('Error requesting server: ' + err + exc);
            },
        });
    }
}
