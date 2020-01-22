function render_gb(options) {
    if (options.value === undefined || options.value === null) return '';
    return Math.round(options.value / 1000 / 1000 / 1000) + ' <small class="muted">GB</small>';
}

function render_tb(options) {
    if (options.value === undefined || options.value === null) return '';
    return Math.round(options.value / 1000 / 1000 / 1000 / 1000) + ' <small class="muted">TB</small>';
}

function render_tb_float(options) {
    if (options.value === undefined || options.value === null) return '';
    return (options.value / 1000.0 / 1000 / 1000 / 1000).toFixed(1) + ' <small class="muted">TB</small>';
}

function render_percent(options) {
    if (options.value === undefined || options.value === null) return '';
    return options.value.toFixed(1) + '<small class="muted">%</small>';
}

function render_datetime(options) {
    return options.value.substr(0, 19).replace('T', ' ');
}

function render_relative_datetime(options) {
    // depends on moment.js and assumes the value is in UTC
    if (options.value === undefined || options.value === null) return '';
    return moment.utc(options.value).fromNow();
}

function render_integer(options) {
    if (options.value < 1000) return options.value;
    return ("" + options.value).replace(/(\d)(?=(\d\d\d)+(?!\d))/g, function($1) { return $1 + "," });
}

function render_boolean(options) {
    if (options.value === undefined || options.value === null) return '';
    return options.value ? 'Yes' : 'No';
}

function render_float(options) {
    if (options.value === undefined || options.value === null) return '';
    return options.value.toFixed(2);
}

render_system_link = _.template('<a href="/system/<%= value %>/"><%= value %></a>')

render_component_state = _.template('<span class="label label-<%= value.toLowerCase() %>"><%= value %></span>')

function validate_date(value) {
    if (!moment(value, 'YYYY-MM-DD', true).isValid()) {
        return 'Invalid date format, use YYYY-MM-DD';
    }
    return true;
}


function selectize_value_setter(rule, value) {
    //used when setting the values of QueryBuilder fields which use Selectize instead of a simple dropdown
    var sel = rule.$el.find('.rule-value-container select')[0].selectize;
    sel.setValue(value);
};

var DataTableMultiQuery = Backbone.View.extend({

    // A compound view of simple and advanced search (DataTableSimpleQuery + DataTableQueryBuilder).
    // Expects the same options as the DataTableQueryBuilder, plus a "title" option.
    // Emits "simple_search" or "advanced_search" events when the search mode changes.

    className: "infi-datatable-multi-query",

    template: '<div class="row">' +
              '    <div class="col-md-6"><h1><%= title %></h1></div>' +
              '    <div class="col-md-4" id="search_wrap"></div>' +
              '    <div class="col-md-2">' +
              '        <button style="width: 100%; margin-top: 10px;" class="toggler btn btn-default btn-sm">' +
              '             Advanced <i class="glyphicon glyphicon-menu-down"></i>' +
              '        </button>' +
              '    </div>' +
              '</div>' +
              '<div class="row hidden">' +
              '    <div class="col-md-12" id="query_builder">' +
              '    </div>' +
              '</div>',

    events: {
        'click .toggler': 'toggle_advanced_search'
    },

    initialize: function(options) {
        this.title = options.title;
        this.simple_search = new DataTableSimpleQuery(options);
        this.advanced_search = new DataTableQueryBuilder(options);
        // Replace the subviews' apply_to_collection with our own
        this.simple_search.apply_to_collection = _.bind(this.apply_to_collection, this);
        this.advanced_search.apply_to_collection = _.bind(this.apply_to_collection, this);
    },

    render: function() {
        // Render all parts
        var self = this;
        var html = _.template(self.template)({title: self.title});
        self.$el.html(html);
        $('#search_wrap', self.el).html(self.simple_search.el);
        self.simple_search.render();
        $('#query_builder', self.el).html(self.advanced_search.el)
        self.advanced_search.render();
        // Show advanced search if there are active rules
        var rule_desc = self.advanced_search.get_rules();
        if (rule_desc && rule_desc.rules) {
            self.toggle_advanced_search();
        }
        // Search on ENTER
        $('#query_builder', self.el).on('keypress', function(e) {
            if (e.keyCode == 13) {
                e.target.blur();
                self.apply_to_collection();
            }
        });
        // Initial focus
        $('#search_wrap input', self.el).focus();
    },

    apply_to_collection: function() {
        var valid = this.is_using_advanced_search() ? this.advanced_search.validate() : true;
        if (valid) {
            this.collection.set_filters(this.get_query_params());
        }
    },

    is_using_advanced_search: function() {
        return $('.hidden', this.el).length == 0;
    },

    toggle_advanced_search: function() {
        // Hide/show the advanced search query builder
        if (this.is_using_advanced_search()) {
            $('.toggler i', this.el).removeClass('glyphicon-menu-up').addClass('glyphicon-menu-down');
            $('#query_builder', this.el).parent().addClass('hidden');
            this.trigger('simple_search');
        }
        else {
            $('.toggler i', this.el).removeClass('glyphicon-menu-down').addClass('glyphicon-menu-up');
            $('#query_builder', this.el).parent().removeClass('hidden');
            this.trigger('advanced_search');
        }
        this.apply_to_collection();
        this.advanced_search.$el.queryBuilder('clearErrors');
    },

    get_query_params: function() {
        if (this.is_using_advanced_search()) {
            // Returns a merged dictionary of the simple and advanced query params
            return _.extend(this.simple_search.get_query_params(), this.advanced_search.get_query_params());
        }
        else {
            // Just the simple search
            return this.simple_search.get_query_params();
        }
    }

});
