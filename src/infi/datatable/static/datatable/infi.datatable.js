var DataTableCollection = Backbone.Collection.extend({

    sort_field: '',
    page: 1,
    default_page_size: 100,
    metadata: {},
    filters: [],
    loading: false,
    last_request_data: [],
    local_storage_prefix: 'infi.datatable.',

    initialize: function(models, options) {
        // If there's a query string in the URL, restore the collection state from it
        var self = this;
        self.visibility = {}
        if (window.location.search) {
            self._restore_state_from_url();
        }
        // Local storage page size takes overrides query page size.
        self.load_state_from_storage();
        // Use default page size if both
        self.page_size = self.page_size || self.default_page_size;
        self._save_state_to_url(true /* replace */);

        // Update the collection state when BACK button is pressed
        window.addEventListener('popstate', function(e) {
            if (window.location.search) {
                self._restore_state_from_url();
            } else {
                self._reset_state();
            }
        });

        // After the collection is fetched, check if it should be reloaded
        self.on('sync', self.reload_if_changed, self);

    },

    _restore_state_from_url: function() {
        // Parse query string
        var params_list = [];
        var params = {}
        window.location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(str, key, value) {
            decoded = decodeURIComponent(value)
            params_list.push([key, decoded]);
            params[key] = decoded;
        });
        // Get the parameters we know
        this.sort_field = params.sort || this.sort_field;
        this.page = parseInt(params.page || this.page);
        if (params.page_size) {
            this.page_size = parseInt(params.page_size);
        }

        // All the rest are persumed to be filters
        this.filters = _.filter(params_list, function(pair) {
            return ['sort', 'page', 'page_size'].indexOf(pair[0]) == -1;
        });
        // Trigger an event to allow views to update their state too
        this.trigger('state:restore');
        this.reload(false);
    },

    _reset_state: function() {
        if (this.loading) {
            return
        }
        this.sort_field = '';
        this.page = 1;
        this.page_size = this.default_page_size;
        this.filters = [];
        this.trigger('state:reset');
        this.reload(false);
    },

    _serialize_params: function(pairs) {
        var str = [];
        for (var i = 0; i < pairs.length; ++i) {
            var pair = pairs[i]
            str.push(encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]));
        }
        return str.join("&");
    },

    _save_state_to_url: function(replace) {
        var state = this.get_request_data();
        var query_string = '?' + this._serialize_params(state);
        if (replace) {
            history.replaceState(state, '', query_string + window.location.hash);
        } else if (query_string != window.location.search) {
            history.pushState(state, '', query_string + window.location.hash);
        }
    },

    /* Loading and saving the table state in session storage */

    get_storage_key: function() {
        return 'infi.datatable.' + this.id;
    },

    save_state_to_storage: function() {
        var state = {visibility: this.visibility, page_size: this.page_size};
        try {
            sessionStorage.setItem(this.get_storage_key(), JSON.stringify(state));
        } catch(e) {
        }
    },

    load_state_from_storage: function() {
        var serialized_state = sessionStorage.getItem(this.get_storage_key());
        if (!serialized_state) {
            return;
        }
        try {
            var state = JSON.parse(serialized_state);
            this.page_size = this.page_size || state.page_size;
            _.extend(this.visibility, state.visibility);
        } catch (ex) {
            // JSON parsing failed, log exception but keep going
            // TODO: find a way to cause tests to fail without breaking the
            // UI.
            console.log(ex);
        }
    },

     load: function(reset, on_success) {
        // Loads the collection.
        // reset - whether to clear the current models in the collection
        // on_success - optionally called after loading
        var self = this;
        if (!self.loading) {
            self.loading = true;
            self.trigger('data_requested');
            self.last_request_data = self.get_request_data();
            if (reset === undefined) reset = true;
            self.fetch({
                headers: self.get_request_headers(),
                data: self._serialize_params(self.last_request_data),
                reset: reset,
                remove: false,
                success: function(collection, response, options) {
                    self.loading = false;
                    if (on_success) on_success(collection, response, options);
                },
                error: function(collection, response, options) {
                    self.loading = false;
                    self.parse(response.responseJSON); // parse the response to update self.metadata
                    if (response.status == 403) {
                        self.metadata = {number_of_objects: 0};
                        self.reset();
                        window.alert('Error: you are not logged in, data cannot be retrieved from the server, ' +
                            'please refresh the page.');
                    }
                }
            });
        }
    },

    reload: function(save_state_to_storage) {
        // Load the collection, unless it hasn't been loaded previously
        // Also pushes the state of the collection to the browser history, for BACK button support
        if (_.keys(this.metadata).length > 0) {
            if (save_state_to_storage) {
                this._save_state_to_url();
            }
            this.load(true);
        }
    },

    reload_if_changed: function() {
        // While loading the collection, there may have been a change in the
        // filtering/sorting/pagination that requires a reload.
        // This function is called after a "sync" event, so setTimeout is used
        // to allow any other listeners to process the event before starting another request.
        if (_.isEqual(this.last_request_data, this.get_request_data())) return;
        var self = this;
        setTimeout(function() { self.reload(true) }, 1);
    },

    parse: function(response) {
        if (response) {
            this.metadata = response.metadata;
            return response.result;
        }
        return null;
    },

    is_loading: function() {
        return this.loading;
    },

    get_request_headers: function() {
        return {};
    },

    get_request_data: function() {
        return [['sort', this.sort_field],
                ['page', this.page],
                ['page_size', this.page_size]].concat(this.filters);
    },

    set_sort: function(sort) {
        if (this.sort_field != sort) {
            this.sort_field = sort;
            this.page = 1;
            this.reload(true);
        }
    },

    set_page: function(page) {
        if (this.page != page) {
            this.page = page;
            this.reload(true);
        }
    },

    is_last_page: function() {
        // Returns true if the current page is the last one
        return this.page >= this.metadata.pages_total;
    },

    next_page: function(on_success) {
        // Load the next page into the collection, without removing existing
        // items. This is useful for implementing "infinite scrolling".
        if (!this.is_last_page() && !this.is_loading()) {
            this.page++;
            this.load(false, on_success);
        }
    },

    set_page_size: function(page_size) {
        if (this.page_size != page_size) {
            this.page_size = page_size;
            this.page = 1;
            this.save_state_to_storage();
            this.reload(true);
        }
    },

    set_filters: function(filters) {
        this.filters = filters;
        this.page = 1;
        this.reload(true);
    },

    get_filter_value: function(name) {
        for (var i = 0; i < this.filters.length; i++) {
            if (this.filters[i][0] == name) {
                return this.filters[i][1];
            }
        }
        return null;
    }

});


var DataTable = Backbone.View.extend({

    tagName: "table",

    className: "table table-hover table-bordered infi-datatable",

    events: {
        'change .settings input':         'handle_visibility',
        'click th.sortable':              'handle_sort',
        'click .settings .dropdown-menu': 'prevent_settings_hide',
        'click tbody tr':                 'handle_row_click'
    },

    custom_row_styles: function(model) { return [] },

    row_template:       _.template(
                            '<tr tabindex="<%- tabindex %>" data-row-id="<%- model.id %>" <%= rowClassNameExpression %>>' +
                            '    <% _.each(columns, function(column, index) { %>' +
                            '        <td class="td_<%- column.name.replace(".", "_") %> <%- column.classes %>"><%= values[index] %></td>' +
                            '    <% }) %>' +
                            '</tr>'
                        ),

    settings_template:  _.template(
                            '<div class="settings" style="position: absolute; right: 20px; top: 15px; z-index: 100;">' +
                            '    <button type="button" class="btn btn-default btn-xs dropdown-toggle" data-toggle="dropdown"><i class="glyphicon glyphicon-th-list"></i></button>' +
                            '    <div class="panel panel-default dropdown-menu dropdown-menu-right" style="white-space: nowrap; min-width: initial; font-size: inherit">' +
                            '        <% _.each(columns, function(c) { %>' +
                            '            <label class="themed-checkbox" style="display: block; padding: 5px 20px 0 10px;">' +
                            '                <input type="checkbox"' +
                            '                       <% if (column_visible(c)) print("checked") %>' +
                            '                       <% if (c.toggleable === false) print("disabled") %>' +
                            '                       name="<%- c.name %>"><span></span> <%- column_title(c) %></label>' +
                            '        <% }) %>' +
                            '    </div>' +
                            '</div>'
                        ),

    css_template:       _.template(
                            '<% _.each(self.columns, function(c) { %>' +
                            '    #<%= self.id %> .td_<%- c.name.replace(".", "_") %>, #<%= self.id %> .th_<%- c.name.replace(".", "_") %> {' +
                            '        display: <% print(self.column_visible(c) ? "table-cell" : "none") %>;' +
                            '        width: <%- self.column_width(c) %>;' +
                            '    }' +
                            '<% }) %>' +
                            '.infi-datatable { table-layout: fixed; }' +
                            '.infi-datatable caption { padding: 0; }' +
                            '.infi-datatable th .glyphicon-chevron-down { display: none; }' +
                            '.infi-datatable th .glyphicon-chevron-up { display: none; }' +
                            '.infi-datatable th.desc .glyphicon-chevron-down { display: inline-block; }' +
                            '.infi-datatable th.asc .glyphicon-chevron-up { display: inline-block; }'
                        ),

    download_template: _.template(
                            '<div class="modal download-modal" tabindex="-1">' +
                            '    <div class="modal-dialog modal-sm">' +
                            '        <div class="modal-content">' +
                            '            <div class="modal-body">' +
                            '                <p>Preparing Download</p>' +
                            '                <div class="progress">' +
                            '                  <div class="progress-bar progress-bar-striped active"></div>' +
                            '                </div>' +
                            '            </div>' +
                            '            <div class="modal-footer">' +
                            '                <button type="button" class="btn btn-default">Cancel</button>' +
                            '            </div>' +
                            '        </div>' +
                            '    </div>' +
                            '</div>    '
                        ),

    initialize: function(options) {
        var self = this;
        self.custom_row_styles = options.custom_row_styles || this.custom_row_styles;
        self.columns = options.columns;
        self.row_click_callback = options.row_click_callback || _.noop;
        self.allow_row_focus = options.allow_row_focus === undefined ? true : options.allow_row_focus;
        _.each(self.columns, function(column) {
            if (!_.has(self.collection.visibility, column.name)) {
                self.collection.visibility[column.name] = _.has(column, 'visible') ? column.visible : true;
            }
        });
        self.collection.on('reset update', _.bind(self.render_tbody, self));
        self.collection.on('state:reset state:restore', _.bind(self.handle_collection_state, self));
    },

    /* Rendering */

    render: function() {
        this.$el.html('<caption></caption><thead></thead><tbody></tbody>');
        this.style = $('<style/>');
        $('head').append(this.style);
        this.render_caption();
        this.render_thead();
        this.render_tbody();
        this.render_css();
        this.handle_collection_state();
        return this;
    },

    render_caption: function() {
        var self = this;
        var settings = self.settings_template({
            columns: self.columns,
            column_title: self.column_title,
            column_visible: _.bind(self.column_visible, self)
        });
        $('caption', this.el).append(settings);
    },

    render_thead: function() {
        var self = this;
        var tr = $('<tr/>');
        _.each(this.columns, function(column) {
            var title = $('<div/>').html(self.column_title(column));
            var th = $('<th/>').addClass('th_' + column.name.replace('.', '_')).data('column', column.name);
            if (column.sortable != false) {
                title.append('<i class="glyphicon glyphicon-chevron-up"></i><i class="glyphicon glyphicon-chevron-down"></i>');
                th.addClass('sortable');
            }
            th.html(title);
            th.data("default_sort", column.default_sort || 'asc');
            tr.append(th);
        });
        $('thead', self.el).html(tr);
    },

    render_tbody: function() {
        var self = this;
        var tbody = $('tbody', self.el);
        if (tbody.length == 0) {
            self.render();
        }
        else {
            var html = '';
            self.collection.each(function(model) {
                var values = self.row_for_model(model);
                var custom_classes = self.custom_row_styles(model);
                var rowClassNameExpression = custom_classes ?
                    'class="' + custom_classes.join(' ') + '"' : '';
                html += self.row_template({
                  model: model,
                  columns: self.columns,
                  values: values,
                  rowClassNameExpression: rowClassNameExpression,
                  tabindex: self.allow_row_focus ? 0 : -1
                });
            });
            tbody.html(html);
        }
        // Trigger data_rendered event
        self.trigger('data_rendered');
        // Handle ENTER keypresses
        self.$el.keypress('tr', function(e) {
            if (e.keyCode == 13) {
                $(e.target).click();
                e.stopImmediatePropagation();
                return;
            }
        });
    },

    row_for_model: function(model, is_csv) {
        // Given a model, returns the array of column values to display
        var values = [];
        var self = this;
        _.each(this.columns, function(column) {
            var value = self.get_value(model, column);
            // if being called from download method, need to check if the column was set to use render during the download
            if (is_csv){
                if (column.render && column.render_in_download) value = column.render({model: model, column: column, value: value});
            } else {
                if (column.render) value = column.render({model: model, column: column, value: value});
            }
            values.push(value);
        });
        return values;
    },

    get_value: function(model, column){
        //helper method to find the given column's value in the model
        // if the column.name addresses a nested field (contains '.') it will dig into the model
        var keys = column.name.split('.');
        var key = keys[0];
        var nested_keys = keys.slice(1);
        var value = model.get(key);
        if (value != null && typeof(value) == 'object'){
            return this.nested_value(value, nested_keys);
        } else {
            return value;
        }
    },

    nested_value: function(value, columns){
        // for a given object value and a list of columns names representing the path to the required nested field
        // the function will get into the object and will return the nested value
        var res = value;
        if (columns){
            _.each(columns, function(c){
                if (res != null && typeof(res)=='object'){
                    // get into the next nested level
                    res = res[c]
                } else {
                    // if didn't find some inner column during the path, the function will return null
                    res = null;
                }
             }
            );
        }
        return res;
    },

    render_css: function() {
        this.style.html(this.css_template({self: this}));
    },

    render_sorting: function(th, asc) {
        // Mark the given th cell as sorted, in ascending or descending order.
        var tr = th.parent();
        tr.find('th').removeClass('asc desc')
        th.addClass(asc ? 'asc' : 'desc');
    },

    /* Getting info about columns */

    column_title: function(column) {
        if (_.has(column, 'title')) return column.title;
        var s = column.name.replace(/_/g, ' ');
        s = s.replace(/\w\S*/g, function(s) {
            return s.charAt(0).toUpperCase() + s.substr(1).toLowerCase();
        });
        return s;
    },

    column_width: function(column) {
        var w = _.has(column, 'width') ? column.width : 'auto';
        if (typeof w === 'number') w += 'px';
        return w;
    },

    column_visible: function(column) {
        return this.collection.visibility[column.name];
    },

    /* Event handlers */

    handle_visibility: function(e) {
        var self = this;
        $('.settings input', this.el).each(function() {
            self.collection.visibility[$(this).attr('name')] = $(this).is(':checked');
        });
        self.collection.save_state_to_storage();
        self.render_css();
    },

    prevent_settings_hide: function(e) {
        e.stopPropagation();
    },

    handle_sort: function(e) {
        if (this.collection.is_loading()) return;
        var th = $(e.target).closest('th');
        var asc;
        if (th.hasClass('asc')) asc = false;
        else if (th.hasClass('desc')) asc = true;
        else asc = th.data('default_sort') == 'asc';
        this.render_sorting(th, asc);
        this.collection.set_sort((asc ? '' : '-') + th.data('column'));
    },

    handle_row_click: function(e) {
        var t = e.target.tagName;
        if (t != 'A' && t != 'BUTTON' && t != 'INPUT') {
            var tr = $(e.target).closest('tr');
            var id = tr.data('row-id');
            var model = this.collection.get(id);
            this.row_click_callback(model);
        }
    },

    handle_collection_state: function() {
        // Mark the sorted column
        var sort = this.collection.sort_field;
        var asc = true;
        if (sort && sort[0] == '-') {
            sort = sort.substr(1);
            asc = false;
        }
        this.render_sorting($('thead .th_' + sort, this.$el), asc);
    },

    download: function(filename) {
        // Clone the collection, so that we can download all pages without affecting the real collection
        var self = this;
        var collection = self.collection.clone();
        collection._save_state_to_url = _.noop()
        collection.page_size = 1000;
        // Display the download modal
        self.show_download_modal();
        var cancelled = false;
        $('.download-modal button').on('click', function() {
            cancelled = true;
            self.hide_download_modal();
        })
        // Start building the data
        var titles = _.map($('th', self.el), $.text);
        var rows = [self.as_csv(titles)];
        // This function is called once all pages were loaded
        function save_downloaded_data() {
            self.hide_download_modal();
            var blob = new Blob([rows.join('\n')], {type: 'text/csv'});
            saveAs(blob, filename + '.csv'); // implemented by FileSaver.js
        }
        // This function is called recursively to download all pages
        function download_page(page) {
            collection.page = page;
            collection.load(true, function() {
                if (cancelled) return;
                // Update progress bar
                var progress = 100.0 * collection.metadata.page / collection.metadata.pages_total;
                $('.download-modal .progress-bar').width(progress + '%');
                // Convert the models to CSV rows
                collection.each(function(model) {
                    var values = self.row_for_model(model, true);
                    rows.push(self.as_csv(values));
                });
                // Continue to next page or finish
                if (collection.metadata.next) {
                    download_page(page + 1);
                }
                else {
                    save_downloaded_data();
                }
            });
        };
        // Initiate the download
        download_page(1);
    },

    as_csv: function(values) {
        // Convert an array of values to a CSV string, stripping any HTML tags
        var row = '<div>"' + values.join('","') + '"</div>';
        return $(row).text();
    },

    show_download_modal() {
        var self = this;
        $('body').append(self.download_template());
        $('.download-modal').modal();
    },

    hide_download_modal() {
        $('.download-modal').modal('hide').detach();
    }

});


var DataTablePaginator = Backbone.View.extend({

    tagName: 'nav',
    className: 'infi-datatable-paginator',
    show_settings: true,
    is_primary: true,
    page_sizes: [10, 30, 100],

    template: '&nbsp;<div class="btn-group" style="display: inline; float: right;">' +
              '    <button type="button" class="btn btn-default dropdown-toggle" data-toggle="dropdown">' +
              '        <i class="glyphicon glyphicon-cog"></i>' +
              '    </button>' +
              '    <ul class="dropdown-menu dropdown-menu-right">' +
              '        <% _.each(page_sizes, function(size) { %>' +
              '            <li><a href="#" class="menu-page-size" data-size="<%= size %>">Page Size: <%= size %></i></a></li>' +
              '        <% }); %>' +
              '    </ul>' +
              '</div>',

    events: {
        'click .menu-page-size': 'handle_page_size',
    },

    initialize: function(options) {
        this.collection.on('reset', _.bind(this.render, this));
        if (options) {
            if (_.has(options, 'is_primary')) {
                this.is_primary = options.is_primary;
            }
            if (_.has(options, 'show_settings')) {
                this.show_settings = options.show_settings;
            } else {
                this.show_settings = this.is_primary;
            }
            if (_.has(options, 'page_sizes')) {
                this.page_sizes = options.page_sizes;
            }
        }
    },

    render: function() {
        var self = this;
        self.$el.empty();
        if (self.collection.metadata.pages_total > 1) {
            self.$el.bootpag({
                total: self.collection.metadata.pages_total,
                page: self.collection.metadata.page,
                maxVisible: 5,
                firstLastUse: true,
                leaps: false,
                wrapClass: 'pagination',
                first: '<i class="glyphicon glyphicon-step-backward"></i>',
                last: '<i class="glyphicon glyphicon-step-forward">',
                prev: '<i class="glyphicon glyphicon-backward"></i>',
                next: '<i class="glyphicon glyphicon-forward"></i>',
            }).on('page', function(event, num) {
                self.collection.set_page(num);
            });
            self.$el.on('keypress', function(e) {
                if (e.keyCode == 'k'.charCodeAt(0) ) {
                    self.collection.set_page(
                        Math.min(self.collection.metadata.pages_total, self.collection.page + 1));
                    e.stopImmediatePropagation();
                    return;
                }
                if (e.keyCode == 'j'.charCodeAt(0)) {
                    self.collection.set_page(Math.max(1, self.collection.page - 1)) ;
                    e.stopImmediatePropagation();
                    return;
                }
            });
        }
        if (self.show_settings) {
            var settings = _.template(self.template)({page_sizes: self.page_sizes});
            self.$el.append(settings);
        }
        self.mark_current_page_size();
    },

    mark_current_page_size: function() {
        var size = this.collection.page_size;
        $('.menu-page-size', this.el).each(function() {
            var a = $(this);
            a.find('i').detach();
            if (a.attr('data-size') == size) {
                a.append(' <i class="glyphicon glyphicon-ok"></i>');
            }
        });
    },

    handle_page_size: function(e) {
        e.preventDefault();
        var size = $(e.target).attr('data-size');
        this.collection.set_page_size(size);
    }

});


var DataTableCounter = Backbone.View.extend({

    tagName: 'span',
    className: "infi-datatable-counter",

    initialize: function(options) {
        this.collection.on('reset', _.bind(this.render, this));
    },

    render: function() {
        var self = this;
        var metadata = self.collection.metadata;
        var count = metadata.number_of_objects.toLocaleString();
        if (metadata.limited_number_of_objects && metadata.page < metadata.pages_total) {
            count = ">" + count;
        }
        else if (metadata.approximated_number_of_objects && metadata.page < metadata.pages_total) {
            count = "~" + count;
        }
        self.$el.text(count);
    }

});


var DataTableSimpleQuery = Backbone.View.extend({

    className: "infi-datatable-simple-query",

    template: '<div class="form-group has-feedback">' +
              '    <input name="<%= field_name %>" placeholder="Search" class="form-control" maxlength="50" value="<%= field_value %>">' +
              '    <span class="glyphicon glyphicon-search form-control-feedback"></span>' +
              '</div>',

    events: {
        'input': 'handle_change'
    },

    initialize: function(options) {
        this.field_name = options.field_name || 'q';
        this.collection.on('state:reset state:restore', _.bind(this.handle_collection_state, this));

    },

    render: function() {
        var html = _.template(this.template)({
            field_name: this.field_name,
            field_value: this.collection.get_filter_value(this.field_name) || ''
        });
        this.$el.html(html);
    },

    handle_change: _.debounce(
        function(e) {
            this.apply_to_collection();
        },
        300
    ),

    get_query_params: function() {
        var params = []
        params.push([this.field_name, this.$el.find('input').val()]);
        return params;
    },

    apply_to_collection: function() {
        this.collection.set_filters(this.get_query_params());
    },

    handle_collection_state: function() {
        // Update the contents of the search field
        $('input', this.el).val(this.collection.get_filter_value(this.field_name));
    }

});


var DataTableQueryBuilder = Backbone.View.extend({

    className: "infi-datatable-query-builder",

    operators: [
        {type: 'contains',     to_api: 'like',      nb_inputs: 1, multiple: false, apply_to: ['string']},
        {type: 'not_contains', to_api: 'unlike',    nb_inputs: 1, multiple: false, apply_to: ['string']},
        {type: '=',            to_api: 'eq',        nb_inputs: 1, multiple: false, apply_to: ['string', 'number', 'boolean']},
        {type: '!=',           to_api: 'ne',        nb_inputs: 1, multiple: false, apply_to: ['string', 'number', 'boolean']},
        {type: '<',            to_api: 'lt',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: '<=',           to_api: 'le',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: '>',            to_api: 'gt',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: '>=',           to_api: 'ge',        nb_inputs: 1, multiple: false, apply_to: ['number', 'datetime']},
        {type: 'in',           to_api: 'in',        nb_inputs: 1, multiple: true,  apply_to: []},
        {type: 'not_in',       to_api: 'out',       nb_inputs: 1, multiple: true,  apply_to: []},
        {type: 'between',      to_api: 'between',   nb_inputs: 2, multiple: false, apply_to: ['number', 'datetime']},
        {type: 'is null',       to_api: 'isnull',    nb_inputs: 0, multiple: false, apply_to: ['number', 'string', 'datetime', 'boolean']},
        {type: 'is not null',    to_api: 'isnotnull', nb_inputs: 0, multiple: false, apply_to: ['number', 'string', 'datetime', 'boolean']},
    ],

    initialize: function(options) {
        this.filter_fields = options.filter_fields;
        this.plugins = options.plugins || { 'bt-tooltip-errors': { delay: 100 }, 'filter-description': {} };
        this.collection.on('state:reset state:restore', _.bind(this.handle_collection_state, this));
    },

    render: function() {
        this.$el.queryBuilder({
            filters: this.filter_fields,
            operators: this.operators,
            plugins: this.plugins,
            allow_empty: true,
            allow_groups: false,
            conditions: ['AND'],
            lang: {  "delete_rule": "Remove",
                     "delete_group": "Remove"}
        });
        this.handle_collection_state();
    },

    update_filter: function(options, field_name) {
        for (var i = 0; i < this.filter_fields.length; i++) {
            filter_field = this.filter_fields[i];
            if (filter_field.id == field_name) {
                $.extend(filter_field, options);
                return;
            }
        }
        alert('Cannot update filter field ' + field_name);
    },

    get_rules: function() {
        return this.$el.queryBuilder('getRules');
    },

    set_rules: function(rules) {
        return this.$el.queryBuilder('setRules', rules);
    },

    validate: function() {
        return this.$el.queryBuilder('validate');
    },

    operator_to_api: function(operator) {
        // Convert Query Builder operator name to API operator name
        return _.findWhere(this.operators, {type: operator}).to_api;
    },

    api_to_operator: function(api_op) {
        // Convert API operator name to Query Builder operator name
        return _.findWhere(this.operators, {to_api: api_op}).type;
    },

    get_query_params: function() {
        // Convert the current rules into API query params
        var self = this;
        var rules = self.get_rules();
        var params = []
        _.each(rules.rules, function(rule) {
            var value = self.operator_to_api(rule.operator);
            if (rule.value){
                value += ':' + rule.value.toString();
            } else {
                value += ':1';
            }
            params.push([rule.id, value]);
        });
        return params
    },

    apply_to_collection: function() {
        if (this.validate()) {
            this.collection.set_filters(this.get_query_params());
        }
    },

    handle_collection_state: function() {
        // Convert the collection's filters into Query Builder rules
        var self = this;
        var operator, value, key;
        var rules = [];
        var filter_field_names = _.pluck(this.filter_fields, 'id');
        _.each(self.collection.filters, function(filter) {
            key = filter[0];
            value = filter[1];
            if (_.indexOf(filter_field_names, key) == -1) return; // skip unknown field names
            var colon_location = value.indexOf(':');
            if (colon_location == -1) {
                  operator = 'eq';
            } else {
                operator = value.slice(0, colon_location);
                value = value.slice(colon_location + 1);
            }
            if (operator == 'in' || operator == 'out' || operator == 'between') {
                value = value.split(',');
            }
            if (operator == 'isnull' || operator == 'isnotnull'){
                //if value = 0, need to change isnull to isnotnull and vice versa
                if (value == "0"){
                    operator = operator == 'isnull' ? 'isnotnull' : 'isnull';
                }
            }
            rules.push({
                id: key,
                operator: self.api_to_operator(operator),
                value: value
            });
        });
        // Initialize the Query Builder
        if (rules.length) {
            self.$el.queryBuilder('setRules', {condition: 'AND', rules: rules});
        }
        else {
            self.$el.queryBuilder('reset');
        }
    }
});
